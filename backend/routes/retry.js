const express = require("express");
const supabase = require("../config/supabase");
const { predictRetryWindows, calculateRiskScore } = require("../services/retryEngine");
const { validateRetry } = require("../services/policyService");
const { predictRetryWindowsWithMl, MlServiceError } = require("../services/mlService");

const router = express.Router();

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

/**
 * POST /api/retry/predict/:paymentId
 * Core Retry Intelligence API — fetches the payment (and its customer
 * history) from Supabase, sends it to the deployed RevRec AI ML service for
 * a real, model-backed prediction across several retry windows, then
 * persists the result. Policy/guardrail decisions are handled entirely
 * separately by /validate and /execute below — this endpoint only predicts
 * timing, it never decides whether a retry is allowed.
 */
router.post("/predict/:paymentId", async (req, res) => {
    try {
        const payment = await getPaymentOr404(res, req.params.paymentId);
        if (!payment) return;

        let prediction;
        try {
            prediction = await predictRetryWindowsWithMl(payment);
        } catch (mlError) {
            console.error(
                `[retry/predict] ML prediction failed for payment ${payment.id}` +
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

        const { data: savedPrediction, error: insertError } = await supabase
            .from("retry_predictions")
            .insert({
                payment_id: payment.id,
                retry_now_probability: prediction.probabilities.retry_now,
                retry_15min_probability: prediction.probabilities.retry_15min,
                retry_1hour_probability: prediction.probabilities.retry_1hr,
                retry_6hour_probability: prediction.probabilities.retry_6hr,
                retry_tomorrow_probability: prediction.probabilities.retry_tomorrow,
                recommended_window: prediction.recommendedWindow,
                expected_recovery_value: prediction.expectedRecoveryValue
            })
            .select()
            .single();
        if (insertError) throw insertError;

        // Keep the payment's risk_score in sync with the latest prediction.
        await supabase.from("payments").update({ risk_score: prediction.riskScore }).eq("id", payment.id);

        const { error: eventError } = await supabase.from("payment_events").insert({
            payment_id: payment.id,
            event_type: "ML_PREDICTION_CREATED",
            event_data: {
                prediction_id: savedPrediction.id,
                recommended_window: prediction.recommendedWindow,
                best_probability: prediction.bestProbability,
                expected_recovery_value: prediction.expectedRecoveryValue
            }
        });
        if (eventError) throw eventError;

        res.json({
            success: true,
            data: {
                probabilities: prediction.probabilities,
                recommendedWindow: prediction.recommendedWindow,
                recommendedWindowLabel: prediction.recommendedWindowLabel,
                bestProbability: prediction.bestProbability,
                expectedRecoveryValue: prediction.expectedRecoveryValue,
                riskScore: prediction.riskScore,
                explanation: prediction.explanation,
                predictionId: savedPrediction.id,
                // Additive — the RevRec AI ML service's raw model info, for
                // clients that want it. Existing fields above are unchanged.
                ml: prediction.mlMeta
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/retry/validate/:paymentId
 * Runs policy guardrails and returns APPROVED or BLOCKED with reasons.
 * Read-only — does not mutate the payment.
 */
router.post("/validate/:paymentId", async (req, res) => {
    try {
        const payment = await getPaymentOr404(res, req.params.paymentId);
        if (!payment) return;

        const result = await validateRetry(supabase, payment);

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/retry/execute/:paymentId
 * Re-validates guardrails, then simulates a retry attempt: updates the
 * payment, logs an audit event, and simulates recovery or failure based on
 * the "retry now" probability from the intelligence engine.
 */
router.post("/execute/:paymentId", async (req, res) => {
    try {
        const payment = await getPaymentOr404(res, req.params.paymentId);
        if (!payment) return;

        // Guardrails must pass before we ever attempt the retry.
        const validation = await validateRetry(supabase, payment);
        if (validation.decision === "BLOCKED") {
            return res.status(422).json({
                success: true,
                data: { executed: false, decision: "BLOCKED", reasons: validation.reasons }
            });
        }

        const attemptNumber = payment.previous_attempts + 1;
        const prediction = predictRetryWindows(payment);
        const successProbability = prediction.probabilities.retry_now;

        // Audit event: the attempt itself, independent of its outcome.
        await supabase.from("payment_events").insert({
            payment_id: payment.id,
            event_type: "RETRY_EXECUTED",
            event_data: { attempt_number: attemptNumber, success_probability: successProbability }
        });

        // Simulate the outcome using the predicted probability as the odds of success.
        const isSuccess = Math.random() < successProbability;
        const newStatus = isSuccess ? "recovered" : "failed";

        const { data: updatedPayment, error: updateError } = await supabase
            .from("payments")
            .update({
                status: newStatus,
                previous_attempts: attemptNumber,
                updated_at: new Date().toISOString()
            })
            .eq("id", payment.id)
            .select()
            .single();
        if (updateError) throw updateError;

        await supabase.from("payment_events").insert({
            payment_id: payment.id,
            event_type: isSuccess ? "PAYMENT_RECOVERED" : "RETRY_ATTEMPT_FAILED",
            event_data: {
                attempt_number: attemptNumber,
                amount: payment.amount,
                success_probability: successProbability
            }
        });

        res.json({
            success: true,
            data: {
                executed: true,
                decision: "APPROVED",
                outcome: isSuccess ? "RECOVERED" : "FAILED",
                payment: updatedPayment
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
