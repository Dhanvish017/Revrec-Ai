const express = require("express");
const Razorpay = require("razorpay");

const router = express.Router();

// Lazily construct the client so a missing key at require-time can't crash
// the whole server — only this route fails until the env vars are set.
let razorpayClient = null;
function getRazorpayClient() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        throw new Error("Razorpay is not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET");
    }

    if (!razorpayClient) {
        razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return razorpayClient;
}

/**
 * POST /api/razorpay/create-order
 * Creates a real Razorpay Test Mode order via the Razorpay SDK.
 * This is separate from /api/payments/create-test — no row is written to
 * Supabase here, this only talks to Razorpay.
 */
router.post("/create-order", async (req, res) => {
    try {
        const { amount, currency, receipt, notes, customerName, customerEmail } = req.body;

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({ success: false, error: "amount must be a positive number" });
        }

        const razorpay = getRazorpayClient();

        const orderNotes = { ...(notes || {}) };
        if (customerName) orderNotes.customer_name = customerName;
        if (customerEmail) orderNotes.customer_email = customerEmail;

        // Razorpay expects amount in the smallest currency unit (e.g. paise for INR),
        // so a rupee amount from the request is converted here.
        const order = await razorpay.orders.create({
            amount: Math.round(Number(amount) * 100),
            currency: currency || "INR",
            receipt: receipt || `receipt_${Date.now()}`,
            notes: orderNotes
        });

        // Only ever return the public key_id — RAZORPAY_KEY_SECRET never leaves this file.
        res.status(201).json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                key_id: process.env.RAZORPAY_KEY_ID
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || "Failed to create Razorpay order" });
    }
});

module.exports = router;
