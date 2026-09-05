const express = require("express");
const supabase = require("../config/supabase");
const { validateRetry } = require("../services/policyService");
const { predictRetryWindowsWithMl, MlServiceError } = require("../services/mlService");

const router = express.Router();

// No new table: recovery actions are audit rows in the existing
// payment_events table, same as PAYMENT_FAILED / RETRY_EXECUTED / etc.
const RECOVERY_MESSAGE_EVENT_TYPE = "RECOVERY_MESSAGE_SENT";
const RECOVERY_ACTION_TYPE = "recovery_message";
// customer_email is the only contact channel guaranteed by the payments
// schema (not null), so it's the one simulated channel used here.
const RECOVERY_CHANNEL = "email";

async function getPaymentOr404(res, paymentId) {
    const { data: payment, error } = await supabase
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .single();

    if (error || !payment) {
        res.status(404).json({ success: false, error: "Payment not found" });
        return null;
    }
    return payment;
}

function formatAmountForMessage(amount, currency) {
    const value = Number(amount) || 0;
    const upperCurrency = (currency || "INR").toUpperCase();
    if (upperCurrency === "INR") {
        return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    }
    return `${upperCurrency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * Builds the simulated recovery message copy from the payment's amount,
 * customer details, and the Razorpay payment id when available. This is
 * Test Mode text only — no WhatsApp/SMS/email provider is ever called.
 */
function buildRecoveryMessage(payment) {
    const amountText = formatAmountForMessage(payment.amount, payment.currency);
    const greeting = payment.customer_name ? `Hi ${payment.customer_name}, y` : "Y";
    const reference = payment.payment_id ? ` (Ref: ${payment.payment_id})` : "";
    return `${greeting}our payment of ${amountText}${reference} could not be completed. Please retry your payment using the payment link provided. Thank you.`;
}

async function findExistingRecoveryAction(paymentId) {
    const { data, error } = await supabase
        .from("payment_events")
        .select("*")
        .eq("payment_id", paymentId)
        .eq("event_type", RECOVERY_MESSAGE_EVENT_TYPE)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

function existingActionResponse(event) {
    const data = event.event_data || {};
    return {
        approved: true,
        decision: "APPROVED",
        reasons: [],
        recommendedWindow: data.recommended_window ?? null,
        recommendedWindowLabel: data.recommended_window_label ?? null,
        message: data.message ?? null,
        channel: data.channel ?? null,
        actionType: data.action_type ?? RECOVERY_ACTION_TYPE,
        executionStatus: data.status ?? "sent",
        testMode: data.test_mode !== false,
        simulated: data.simulated !== false,
        timestamp: data.executed_at || event.created_at,
        recoveryActionId: event.id,
        alreadySent: true
    };
}

/**
 * POST /api/recovery/message/:paymentId
 * Executes the "send a recovery message" action for a failed payment:
 *   1. Predicts the recommended retry window via the existing ML service
 *      (services/mlService.js) — prediction logic itself is untouched.
 *   2. Runs the existing policy guardrails (services/policyService.js). A
 *      BLOCKED decision stops here: no message is generated and nothing is
 *      persisted.
 *   3. If APPROVED, generates a Test Mode simulated recovery message and
 *      stores it as an audit row in payment_events — no new table, no real
 *      WhatsApp/SMS/email provider is ever called.
 * Idempotent: once a recovery message has been sent for a payment, repeat
 * calls (e.g. clicking "Send" again) return the same stored result instead
 * of creating a duplicate row or re-sending.
 */
router.post("/message/:paymentId", async (req, res) => {
    const { paymentId } = req.params;

    try {
        const payment = await getPaymentOr404(res, paymentId);
        if (!payment) return;

        const existing = await findExistingRecoveryAction(payment.id);
        if (existing) {
            console.log(
                `[recovery] payment ${payment.id} already has a recovery action ` +
                    `(event ${existing.id}, sent ${existing.created_at}) — returning existing result, not resending`
            );
            return res.json({ success: true, data: existingActionResponse(existing) });
        }

        console.log(`[recovery] predicting retry window for payment ${payment.id}`);
        let prediction;
        try {
            prediction = await predictRetryWindowsWithMl(payment);
        } catch (mlError) {
            console.error(
                `[recovery] ML prediction failed for payment ${payment.id}` +
                    (mlError instanceof MlServiceError ? ` [${mlError.code}]` : ""),
                mlError.message
            );
            if (mlError instanceof MlServiceError) {
                const status =
                    mlError.code === "ML_TIMEOUT" ? 504 : mlError.code === "ML_NOT_CONFIGURED" ? 500 : 502;
                return res.status(status).json({ success: false, error: mlError.publicMessage });
            }
            throw mlError;
        }
        console.log(
            `[recovery] predicted window for payment ${payment.id}: ${prediction.recommendedWindow} ` +
                `(${Math.round(prediction.bestProbability * 100)}% predicted success)`
        );

        const validation = await validateRetry(supabase, payment);
        console.log(
            `[recovery] policy decision for payment ${payment.id}: ${validation.decision}` +
                (validation.reasons.length ? ` — ${validation.reasons.join(" ")}` : "")
        );

        if (validation.decision === "BLOCKED") {
            console.log(`[recovery] blocked — no recovery message generated or persisted for payment ${payment.id}`);
            return res.json({
                success: true,
                data: {
                    approved: false,
                    decision: "BLOCKED",
                    reasons: validation.reasons,
                    recommendedWindow: prediction.recommendedWindow,
                    recommendedWindowLabel: prediction.recommendedWindowLabel,
                    message: null,
                    channel: null,
                    actionType: RECOVERY_ACTION_TYPE,
                    executionStatus: "blocked",
                    testMode: true,
                    simulated: true,
                    timestamp: new Date().toISOString(),
                    recoveryActionId: null,
                    alreadySent: false
                }
            });
        }

        const message = buildRecoveryMessage(payment);
        const timestamp = new Date().toISOString();

        console.log(
            `[recovery] executing simulated Test Mode ${RECOVERY_CHANNEL} message for payment ${payment.id}: "${message}"`
        );

        const eventData = {
            recommended_window: prediction.recommendedWindow,
            recommended_window_label: prediction.recommendedWindowLabel,
            action_type: RECOVERY_ACTION_TYPE,
            channel: RECOVERY_CHANNEL,
            message,
            status: "sent",
            test_mode: true,
            simulated: true,
            razorpay_payment_id: payment.payment_id || null,
            amount: payment.amount,
            currency: payment.currency,
            customer_name: payment.customer_name,
            customer_email: payment.customer_email,
            executed_at: timestamp
        };

        console.log(`[recovery] persisting recovery action to Supabase for payment ${payment.id}`);
        const { data: savedEvent, error: insertError } = await supabase
            .from("payment_events")
            .insert({
                payment_id: payment.id,
                event_type: RECOVERY_MESSAGE_EVENT_TYPE,
                event_data: eventData
            })
            .select()
            .single();

        if (insertError) {
            console.error(
                `[recovery] Supabase persistence failed for payment ${payment.id}:`,
                insertError.message || insertError
            );
            return res.status(500).json({ success: false, error: insertError.message });
        }

        console.log(`[recovery] Supabase persistence succeeded: event ${savedEvent.id} for payment ${payment.id}`);

        res.status(201).json({
            success: true,
            data: {
                approved: true,
                decision: "APPROVED",
                reasons: [],
                recommendedWindow: prediction.recommendedWindow,
                recommendedWindowLabel: prediction.recommendedWindowLabel,
                message,
                channel: RECOVERY_CHANNEL,
                actionType: RECOVERY_ACTION_TYPE,
                executionStatus: "sent",
                testMode: true,
                simulated: true,
                timestamp,
                recoveryActionId: savedEvent.id,
                alreadySent: false
            }
        });
    } catch (error) {
        console.error(`[recovery] error executing recovery message for payment ${paymentId}:`, error.message || error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
