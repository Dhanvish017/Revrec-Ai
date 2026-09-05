/**
 * Policy Service
 * ---------------------------------------------------------------------------
 * Guardrails that must pass before a retry is allowed to execute. Kept
 * separate from retryEngine.js: the engine decides *when* a retry is likely
 * to succeed, this decides *whether* a retry is allowed to happen at all.
 */

const { calculateRiskScore, getFailureReasonProfile } = require("./retryEngine");

const MAX_RETRY_ATTEMPTS = 5;
const RISK_SCORE_BLOCK_THRESHOLD = 80;

/**
 * Runs every guardrail against a payment and returns a decision.
 * `supabase` and `payment` are passed in (rather than fetched here) so the
 * route stays in control of a single DB round-trip.
 */
async function validateRetry(supabase, payment) {
    const reasons = [];

    // 1. Maximum retry attempts.
    if (payment.previous_attempts >= MAX_RETRY_ATTEMPTS) {
        reasons.push(
            `Maximum retry attempts reached (${payment.previous_attempts}/${MAX_RETRY_ATTEMPTS}).`
        );
    }

    // 2. Payment must not already be successful/recovered.
    if (payment.status === "recovered") {
        reasons.push("Payment is already recovered — no retry needed.");
    }

    // 3. Failure reason must be recoverable via an automated retry.
    const reasonProfile = getFailureReasonProfile(payment.failure_reason);
    if (!reasonProfile.recoverable) {
        reasons.push(
            `Failure reason "${payment.failure_reason}" is not recoverable via automated retry (${reasonProfile.description}).`
        );
    }

    // 4. Duplicate successful payment check — guard against double-charging
    // the same customer for the same amount if another payment already recovered.
    const { data: duplicates, error: duplicateError } = await supabase
        .from("payments")
        .select("id")
        .eq("customer_email", payment.customer_email)
        .eq("amount", payment.amount)
        .eq("status", "recovered")
        .neq("id", payment.id)
        .limit(1);

    if (duplicateError) {
        throw duplicateError;
    }
    if (duplicates && duplicates.length > 0) {
        reasons.push(
            "A successful payment already exists for this customer and amount — blocking to avoid duplicate charge."
        );
    }

    // 5. Risk score check.
    const riskScore = payment.risk_score ?? calculateRiskScore(payment);
    if (riskScore >= RISK_SCORE_BLOCK_THRESHOLD) {
        reasons.push(`Risk score too high (${riskScore}/100, threshold is ${RISK_SCORE_BLOCK_THRESHOLD}).`);
    }

    return {
        decision: reasons.length === 0 ? "APPROVED" : "BLOCKED",
        reasons,
        riskScore
    };
}

module.exports = {
    validateRetry,
    MAX_RETRY_ATTEMPTS,
    RISK_SCORE_BLOCK_THRESHOLD
};
