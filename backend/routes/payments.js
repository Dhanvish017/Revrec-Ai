const express = require("express");
const supabase = require("../config/supabase");

const router = express.Router();

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
