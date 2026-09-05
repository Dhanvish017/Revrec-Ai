const express = require("express");
const supabase = require("../config/supabase");

const router = express.Router();

/**
 * GET /api/dashboard
 * Aggregate recovery metrics computed from the payments table.
 * Every payment starts as "failed" (created by the Razorpay webhook), so:
 *   - totalFailedPayments = every payment ever created
 *   - activeRecoveryCases = payments still unresolved (status === 'failed')
 *   - recoveredPayments   = payments successfully retried (status === 'recovered')
 */
router.get("/", async (req, res) => {
    try {
        const { data: payments, error } = await supabase
            .from("payments")
            .select("amount, status");

        if (error) throw error;

        const totalFailedPayments = payments.length;
        const recoveredPayments = payments.filter((p) => p.status === "recovered");
        const activeRecoveryCases = payments.filter((p) => p.status === "failed");

        const recoveredRevenue = recoveredPayments.reduce((sum, p) => sum + Number(p.amount), 0);
        const revenueAtRisk = activeRecoveryCases.reduce((sum, p) => sum + Number(p.amount), 0);

        const recoveryRate =
            totalFailedPayments === 0 ? 0 : (recoveredPayments.length / totalFailedPayments) * 100;

        res.json({
            success: true,
            data: {
                totalFailedPayments,
                activeRecoveryCases: activeRecoveryCases.length,
                recoveredPayments: recoveredPayments.length,
                recoveredRevenue: Number(recoveredRevenue.toFixed(2)),
                revenueAtRisk: Number(revenueAtRisk.toFixed(2)),
                recoveryRate: Number(recoveryRate.toFixed(2))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
