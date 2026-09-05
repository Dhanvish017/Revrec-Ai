/**
 * Retry Intelligence Engine
 * ---------------------------------------------------------------------------
 * This is a transparent, rule-based scoring engine that predicts the success
 * probability of retrying a failed payment at several future windows.
 *
 * It is deliberately structured so it can be swapped for a real ML model
 * later without touching any route code:
 *   - `extractFeatures(payment)` turns a raw payment row into a flat feature
 *     object. A future model would consume the same features.
 *   - `predictRetryWindows(payment)` is the only function routes call. It
 *     returns the same shape regardless of what's running underneath
 *     (rule engine today, a trained model tomorrow).
 */

// Retry windows we predict for, and how many hours from "now" each one is.
const RETRY_WINDOWS = [
    { key: "retry_now", label: "Retry Now", hoursFromNow: 0 },
    { key: "retry_15min", label: "Retry in 15 Minutes", hoursFromNow: 0.25 },
    { key: "retry_1hr", label: "Retry in 1 Hour", hoursFromNow: 1 },
    { key: "retry_6hr", label: "Retry in 6 Hours", hoursFromNow: 6 },
    { key: "retry_tomorrow", label: "Retry Tomorrow", hoursFromNow: 24 }
];

// Baseline success rate by payment method (industry-style ballpark figures).
const PAYMENT_METHOD_BASE_RATES = {
    upi: 0.62,
    card: 0.52,
    netbanking: 0.48,
    wallet: 0.58,
    emi: 0.45
};
const DEFAULT_METHOD_RATE = 0.5;

// Customer payment pattern modifiers — a customer's historical reliability
// shifts the odds up or down across every window.
const CUSTOMER_PATTERN_MODIFIERS = {
    reliable: 0.15,
    occasional_failure: 0,
    high_risk: -0.18,
    chronic_failure: -0.3
};

/**
 * Failure reason profiles.
 * `curve(hoursFromNow)` returns a delta applied to the base rate at that
 * window — this is what captures "insufficient funds recovers by tomorrow"
 * vs "network error recovers immediately" style intuition.
 * `recoverable: false` reasons are still scored (for transparency) but are
 * flagged so policyService can block automatic retries on them.
 */
const FAILURE_REASON_PROFILES = {
    insufficient_funds: {
        recoverable: true,
        description: "insufficient funds",
        curve: (h) => -0.28 + 0.5 * Math.min(h / 24, 1) // ramps up sharply by tomorrow
    },
    network_error: {
        recoverable: true,
        description: "a transient network/processing error",
        curve: (h) => 0.18 - 0.15 * Math.min(h / 6, 1) // best immediately, fades fast
    },
    processing_error: {
        recoverable: true,
        description: "a transient processing error",
        curve: (h) => 0.15 - 0.13 * Math.min(h / 6, 1)
    },
    bank_decline: {
        recoverable: true,
        description: "a bank-side decline",
        curve: (h) => -0.1 + 0.28 * Math.min(h / 24, 1) // improves steadily
    },
    expired_card: {
        recoverable: false,
        description: "an expired card (requires the customer to update it)",
        curve: (h) => -0.32 + 0.08 * Math.min(h / 24, 1) // stays low regardless of timing
    },
    incorrect_details: {
        recoverable: false,
        description: "incorrect payment details (requires customer correction)",
        curve: (h) => -0.3 + 0.05 * Math.min(h / 24, 1)
    },
    fraud_suspected: {
        recoverable: false,
        description: "suspected fraud",
        curve: () => -0.55 // flat and heavily penalized at every window
    }
};
const DEFAULT_REASON_PROFILE = {
    recoverable: true,
    description: "an unclassified failure",
    curve: (h) => 0.02 * Math.min(h / 24, 1)
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function getFailureReasonProfile(failureReason) {
    const key = (failureReason || "").toLowerCase().trim();
    return FAILURE_REASON_PROFILES[key] || DEFAULT_REASON_PROFILE;
}

/**
 * Turns a raw payment row into the flat set of features the scoring model
 * (rule-based today, ML tomorrow) actually reasons over.
 */
function extractFeatures(payment) {
    const amount = Number(payment.amount) || 0;
    const previousAttempts = Number(payment.previous_attempts) || 0;
    const reasonProfile = getFailureReasonProfile(payment.failure_reason);
    const methodRate =
        PAYMENT_METHOD_BASE_RATES[(payment.payment_method || "").toLowerCase()] ??
        DEFAULT_METHOD_RATE;
    const patternModifier =
        CUSTOMER_PATTERN_MODIFIERS[(payment.customer_pattern || "").toLowerCase()] ?? 0;

    return {
        amount,
        previousAttempts,
        methodRate,
        patternModifier,
        reasonProfile,
        failureReason: payment.failure_reason
    };
}

/**
 * Composite 0-100 risk score. Higher = riskier / less likely to recover.
 * Shared with policyService so guardrails and predictions stay consistent.
 */
function calculateRiskScore(payment) {
    const features = extractFeatures(payment);

    let risk = 30; // baseline

    // More prior attempts without success = fatigue = higher risk.
    risk += Math.min(features.previousAttempts * 12, 40);

    // Non-recoverable failure reasons (fraud, bad details, expired card) are inherently riskier.
    if (!features.reasonProfile.recoverable) risk += 25;

    // Customer pattern shifts risk directly.
    risk -= features.patternModifier * 50;

    // Larger amounts are treated as marginally riskier (more scrutiny / more to lose).
    if (features.amount > 50000) risk += 10;
    else if (features.amount > 10000) risk += 5;

    return Math.round(clamp(risk, 0, 100));
}

/**
 * Core prediction: success probability at each retry window.
 */
function predictRetryWindows(payment) {
    const features = extractFeatures(payment);
    const riskScore = calculateRiskScore(payment);
    const attemptsPenalty = Math.min(features.previousAttempts * 0.07, 0.35);

    const probabilities = {};
    for (const window of RETRY_WINDOWS) {
        const raw =
            features.methodRate +
            features.patternModifier +
            features.reasonProfile.curve(window.hoursFromNow) -
            attemptsPenalty;

        // Keep probabilities in a believable band, never exactly 0 or 1.
        probabilities[window.key] = Number(clamp(raw, 0.03, 0.95).toFixed(4));
    }

    // Pick the window with the highest probability.
    let recommended = RETRY_WINDOWS[0];
    for (const window of RETRY_WINDOWS) {
        if (probabilities[window.key] > probabilities[recommended.key]) {
            recommended = window;
        }
    }

    const bestProbability = probabilities[recommended.key];
    const expectedRecoveryValue = Number((features.amount * bestProbability).toFixed(2));

    const explanation = buildExplanation({
        payment,
        features,
        recommended,
        bestProbability,
        riskScore
    });

    return {
        probabilities,
        recommendedWindow: recommended.key,
        recommendedWindowLabel: recommended.label,
        bestProbability,
        expectedRecoveryValue,
        riskScore,
        explanation
    };
}

function buildExplanation({ payment, features, recommended, bestProbability, riskScore }) {
    const pct = Math.round(bestProbability * 100);
    const parts = [
        `Recommended: ${recommended.label} (${pct}% predicted success).`,
        `This payment failed due to ${features.reasonProfile.description}.`
    ];

    if (features.reasonProfile.recoverable) {
        parts.push(
            recommended.hoursFromNow >= 6
                ? "Waiting helps here because this failure type tends to resolve itself over time (e.g. funds becoming available or the bank re-authorizing)."
                : "This failure type tends to be transient, so retrying soon has the best odds before other factors degrade it."
        );
    } else {
        parts.push(
            "This failure type is unlikely to resolve with a simple retry — success probabilities are capped across all windows and manual customer follow-up (updating card/details) is recommended."
        );
    }

    if (features.previousAttempts > 0) {
        parts.push(
            `${features.previousAttempts} previous attempt(s) slightly lower the odds across every window.`
        );
    }

    if (payment.customer_pattern === "reliable") {
        parts.push("Customer has a reliable payment history, which raises confidence in recovery.");
    } else if (
        payment.customer_pattern === "high_risk" ||
        payment.customer_pattern === "chronic_failure"
    ) {
        parts.push("Customer's payment pattern is high-risk, which lowers confidence in recovery.");
    }

    parts.push(`Overall risk score: ${riskScore}/100.`);

    return parts.join(" ");
}

module.exports = {
    RETRY_WINDOWS,
    extractFeatures,
    calculateRiskScore,
    predictRetryWindows,
    getFailureReasonProfile
};
