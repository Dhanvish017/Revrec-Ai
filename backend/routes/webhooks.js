const express = require("express");
const crypto = require("crypto");
const supabase = require("../config/supabase");
const { calculateRiskScore } = require("../services/retryEngine");

const router = express.Router();

/**
 * Verifies X-Razorpay-Signature: HMAC-SHA256 of the RAW request body,
 * keyed with RAZORPAY_WEBHOOK_SECRET. Per Razorpay's docs this must be
 * computed over the raw bytes, not a re-serialized copy of req.body —
 * req.rawBody is captured by the express.json() verify hook in server.js.
 */
function isValidSignature(rawBody, signature, secret) {
    if (!rawBody || !signature) return false;

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const receivedBuf = Buffer.from(signature, "utf8");

    // Lengths must match before timingSafeEqual — it throws on mismatched lengths.
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Best-effort mapping from Razorpay's error fields to the failure_reason
 * vocabulary retryEngine.js already knows how to score. Falls back to the
 * raw Razorpay reason/code when nothing matches so no information is lost.
 */
function mapFailureReason(paymentEntity) {
    const description = (paymentEntity.error_description || "").toLowerCase();
    const reason = (paymentEntity.error_reason || "").toLowerCase();
    const source = (paymentEntity.error_source || "").toLowerCase();

    if (description.includes("insufficient")) return "insufficient_funds";
    if (description.includes("expired")) return "expired_card";
    if (description.includes("fraud") || reason.includes("fraud")) return "fraud_suspected";
    if (description.includes("incorrect") || description.includes("invalid")) return "incorrect_details";
    if (source === "bank") return "bank_decline";
    if (source === "gateway" || source === "network") return "network_error";

    return reason || paymentEntity.error_code || "unknown_error";
}

async function findPaymentByRazorpayId(razorpayPaymentId) {
    const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("payment_id", razorpayPaymentId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Creates the payment row the first time we see this Razorpay payment id,
 * otherwise updates it. Every event type routes through here so there is
 * always a real payment row to attach the audit event to.
 */
async function upsertPayment(paymentEntity, status, failureReason) {
    console.log(
        `[razorpay-webhook] upserting payment ${paymentEntity.id} -> status=${status}` +
            (failureReason ? ` failure_reason=${failureReason}` : "")
    );

    let existing;
    try {
        existing = await findPaymentByRazorpayId(paymentEntity.id);
    } catch (error) {
        console.error(`[razorpay-webhook] DB lookup failed for payment ${paymentEntity.id}:`, error.message || error);
        throw error;
    }

    const notes = paymentEntity.notes || {};

    if (existing) {
        const { data, error } = await supabase
            .from("payments")
            .update({
                status,
                ...(failureReason ? { failure_reason: failureReason } : {}),
                updated_at: new Date().toISOString()
            })
            .eq("id", existing.id)
            .select()
            .single();

        if (error) {
            console.error(`[razorpay-webhook] DB update failed for payment ${paymentEntity.id}:`, error.message || error);
            throw error;
        }

        console.log(`[razorpay-webhook] DB update succeeded: id=${data.id} payment_id=${data.payment_id} status=${data.status}`);
        return data;
    }

    const draft = {
        payment_id: paymentEntity.id,
        amount: (paymentEntity.amount || 0) / 100, // Razorpay sends paise; table stores rupees.
        currency: paymentEntity.currency || "INR",
        payment_method: paymentEntity.method || "unknown",
        failure_reason: failureReason || "n/a",
        customer_name: notes.customer_name || "Unknown",
        customer_email: notes.customer_email || paymentEntity.email || "unknown@example.com",
        customer_pattern: "occasional_failure",
        previous_attempts: 0,
        status
    };
    draft.risk_score = calculateRiskScore(draft);

    const { data, error } = await supabase.from("payments").insert(draft).select().single();

    if (error) {
        console.error(`[razorpay-webhook] DB insert failed for payment ${paymentEntity.id}:`, error.message || error);
        throw error;
    }

    console.log(`[razorpay-webhook] DB insert succeeded: id=${data.id} payment_id=${data.payment_id} status=${data.status} amount=${data.amount} ${data.currency}`);
    return data;
}

/**
 * POST /api/webhooks/razorpay
 * Receives Razorpay Test Mode webhook events, verifies the signature,
 * dedupes on x-razorpay-event-id, and syncs payment status accordingly.
 */
router.post("/razorpay", async (req, res) => {
    const eventId = req.headers["x-razorpay-event-id"];
    let eventType = "unknown";

    console.log(`[razorpay-webhook] received webhook request (event_id=${eventId || "none"}, bytes=${req.rawBody ? req.rawBody.length : 0})`);

    try {
        const signature = req.headers["x-razorpay-signature"];
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

        if (!secret) {
            console.error("[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not set");
            return res.status(500).json({ success: false, error: "Webhook secret not configured" });
        }

        if (!isValidSignature(req.rawBody, signature, secret)) {
            console.warn(`[razorpay-webhook] signature validation FAILED (event_id=${eventId})`);
            return res.status(400).json({ success: false, error: "Invalid signature" });
        }

        console.log(`[razorpay-webhook] signature validation passed (event_id=${eventId})`);

        eventType = req.body.event;
        const payload = req.body.payload || {};

        console.log(`[razorpay-webhook] event type: ${eventType} (event_id=${eventId})`);

        // Idempotency: if we've already stored this exact event id, skip re-processing
        // but still return 200 so Razorpay doesn't keep retrying it.
        if (eventId) {
            const { data: duplicate, error: dupError } = await supabase
                .from("payment_events")
                .select("id")
                .eq("event_data->>razorpay_event_id", eventId)
                .maybeSingle();
            if (dupError) throw dupError;

            if (duplicate) {
                console.log(`[razorpay-webhook] duplicate event ${eventId} (${eventType}) — skipping`);
                return res.status(200).json({ success: true, message: "duplicate event ignored" });
            }
        } else {
            console.warn(`[razorpay-webhook] event ${eventType} has no x-razorpay-event-id — cannot dedupe`);
        }

        let payment = null;

        switch (eventType) {
            case "payment.failed": {
                const entity = payload.payment && payload.payment.entity;
                if (entity) {
                    console.log(`[razorpay-webhook] payment.failed for razorpay_payment_id=${entity.id}`);
                    payment = await upsertPayment(entity, "failed", mapFailureReason(entity));
                }
                break;
            }
            case "payment.authorized": {
                const entity = payload.payment && payload.payment.entity;
                if (entity) {
                    console.log(`[razorpay-webhook] payment.authorized for razorpay_payment_id=${entity.id}`);
                    payment = await upsertPayment(entity, "authorized", null);
                }
                break;
            }
            case "payment.captured": {
                const entity = payload.payment && payload.payment.entity;
                if (entity) {
                    console.log(`[razorpay-webhook] payment.captured for razorpay_payment_id=${entity.id}`);
                    payment = await upsertPayment(entity, "recovered", null);
                }
                break;
            }
            case "order.paid": {
                // order.paid carries both order and payment entities; the payment
                // entity is the one keyed the same way payment.captured is.
                const entity = (payload.payment && payload.payment.entity) || (payload.order && payload.order.entity);
                if (entity) {
                    console.log(`[razorpay-webhook] order.paid for razorpay_payment_id=${entity.id}`);
                    payment = await upsertPayment(entity, "recovered", null);
                }
                break;
            }
            default:
                console.log(`[razorpay-webhook] received unhandled event type: ${eventType}`);
        }

        if (payment) {
            const { error: eventError } = await supabase.from("payment_events").insert({
                payment_id: payment.id,
                event_type: `RAZORPAY_WEBHOOK_${(eventType || "unknown").toUpperCase().replace(/\./g, "_")}`,
                event_data: {
                    razorpay_event_id: eventId || null,
                    razorpay_event: eventType,
                    payload: req.body
                }
            });
            if (eventError) throw eventError;
        } else {
            // Known event type but no payment entity we could key off of (or an
            // event type we don't handle) — nothing to attach an audit row to.
            console.warn(`[razorpay-webhook] ${eventType} (event_id=${eventId}) not persisted — no matching payment entity`);
        }

        console.log(`[razorpay-webhook] processed ${eventType} (event_id=${eventId})`);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error(`[razorpay-webhook] error processing ${eventType} (event_id=${eventId}):`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
