const crypto = require("crypto");
const express = require("express");
const supabase = require("../config/supabase");
const { calculateRiskScore } = require("../services/retryEngine");

const router = express.Router();

const VALID_CUSTOMER_PATTERNS = ["reliable", "occasional_failure", "high_risk", "chronic_failure"];

// Simulated payments have no real Razorpay payment id, so we mint one —
// keeps the `payment_id` column (required, no DB default) populated with
// something that reads like a real gateway id.
function generateTestPaymentId() {
    return `pay_test_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * POST /api/payments/create-test
 * Creates a simulated failed payment (no real Razorpay integration) and logs
 * a PAYMENT_FAILED event. This is the entry point of the recovery flow.
 */
router.post("/create-test", async (req, res) => {
    try {
        const {
            amount,
            currency,
            paymentMethod,
            failureReason,
            customerName,
            customerEmail,
            customerPattern,
            previousAttempts
        } = req.body;

        // Basic validation — required fields for a meaningful prediction later.
        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({ success: false, error: "amount must be a positive number" });
        }
        if (!paymentMethod || !failureReason || !customerName || !customerEmail) {
            return res.status(400).json({
                success: false,
                error: "paymentMethod, failureReason, customerName, and customerEmail are required"
            });
        }
        if (customerPattern && !VALID_CUSTOMER_PATTERNS.includes(customerPattern)) {
            return res.status(400).json({
                success: false,
                error: `customerPattern must be one of: ${VALID_CUSTOMER_PATTERNS.join(", ")}`
            });
        }

        const paymentDraft = {
            payment_id: generateTestPaymentId(),
            amount: Number(amount),
            currency: currency || "INR",
            payment_method: paymentMethod,
            failure_reason: failureReason,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_pattern: customerPattern || "occasional_failure",
            previous_attempts: Number(previousAttempts) || 0,
            status: "failed"
        };
        paymentDraft.risk_score = calculateRiskScore(paymentDraft);

        const { data: payment, error: insertError } = await supabase
            .from("payments")
            .insert(paymentDraft)
            .select()
            .single();

        if (insertError) throw insertError;

        // Log the failure as an auditable event.
        const { error: eventError } = await supabase.from("payment_events").insert({
            payment_id: payment.id,
            event_type: "PAYMENT_FAILED",
            event_data: {
                amount: paymentDraft.amount,
                payment_method: paymentDraft.payment_method,
                failure_reason: paymentDraft.failure_reason,
                customer_pattern: paymentDraft.customer_pattern,
                previous_attempts: paymentDraft.previous_attempts
            }
        });
        if (eventError) throw eventError;

        res.status(201).json({ success: true, data: payment });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/payments
 * Returns all payments, most recent first.
 */
router.get("/", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("payments")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/payments/:id
 * Returns a single payment with its full retry prediction and event history.
 */
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const { data: payment, error: paymentError } = await supabase
            .from("payments")
            .select("*")
            .eq("id", id)
            .single();

        if (paymentError || !payment) {
            return res.status(404).json({ success: false, error: "Payment not found" });
        }

        const { data: predictions, error: predictionsError } = await supabase
            .from("retry_predictions")
            .select("*")
            .eq("payment_id", id)
            .order("created_at", { ascending: false });
        if (predictionsError) throw predictionsError;

        const { data: events, error: eventsError } = await supabase
            .from("payment_events")
            .select("*")
            .eq("payment_id", id)
            .order("created_at", { ascending: false });
        if (eventsError) throw eventsError;

        res.json({
            success: true,
            data: {
                ...payment,
                retry_predictions: predictions,
                events
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
