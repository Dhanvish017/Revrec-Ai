/**
 * ML Service Client
 * ---------------------------------------------------------------------------
 * Talks to the deployed RevRec AI Python ML service (FastAPI — see
 * ml/app.py) for real, model-backed retry-timing predictions.
 *
 * Scope is deliberately narrow: this module only predicts *when* a retry is
 * likely to succeed. It never decides *whether* a retry is allowed to run —
 * that stays entirely in services/policyService.js, called separately by
 * routes/retry.js's /validate and /execute endpoints.
 */

const supabase = require("../config/supabase");
const { RETRY_WINDOWS, calculateRiskScore } = require("./retryEngine");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL;
const ML_REQUEST_TIMEOUT_MS = 8000;

class MlServiceError extends Error {
    constructor(message, code, publicMessage) {
        super(message);
        this.name = "MlServiceError";
        // "ML_NOT_CONFIGURED" | "ML_TIMEOUT" | "ML_UNAVAILABLE" | "ML_BAD_RESPONSE"
        this.code = code;
        this.publicMessage = publicMessage || message;
    }
}

// ---------------------------------------------------------------------------
// Field mappings: the RevRec payments schema uses its own vocabulary
// (payment_method, failure_reason, customer_pattern) that doesn't line up
// 1:1 with the categories ml/app.py's model was trained on. These maps
// translate one onto the other; unrecognized values fall back to a sane
// default so the request is always valid rather than erroring out.
// ---------------------------------------------------------------------------

const PAYMENT_METHOD_MAP = {
    card: "credit_card",
    upi: "upi",
    netbanking: "bank_transfer",
    wallet: "digital_wallet",
    emi: "credit_card"
};

const FAILURE_REASON_MAP = {
    insufficient_funds: "insufficient_funds",
    network_error: "network_error",
    processing_error: "processing_error",
    bank_decline: "bank_decline_generic",
    expired_card: "expired_card",
    incorrect_details: "incorrect_cvv",
    fraud_suspected: "fraud_suspected"
};

const CUSTOMER_PATTERN_TO_SEGMENT = {
    reliable: "loyal",
    occasional_failure: "returning",
    high_risk: "returning",
    chronic_failure: "new"
};

// ml/app.py always evaluates these five windows (RETRY_WINDOW_OPTIONS) and
// labels them with these short strings. Map them onto the keys the rest of
// this backend (and the frontend) already use everywhere else.
const WINDOW_LABEL_TO_KEY = {
    now: "retry_now",
    "15m": "retry_15min",
    "1h": "retry_1hr",
    "6h": "retry_6hr",
    tomorrow: "retry_tomorrow"
};

function mapWithFallback(map, value, fallback) {
    const key = (value || "").toLowerCase().trim();
    return map[key] || fallback;
}

/**
 * Pulls the customer-history context the model needs (account age, prior
 * successful payments) out of Supabase. There's no separate customers
 * table, so "account age" is approximated from this customer's earliest
 * payment record — no schema changes required.
 */
async function getCustomerContext(payment) {
    const { data: history, error } = await supabase
        .from("payments")
        .select("id, status, created_at")
        .eq("customer_email", payment.customer_email);

    if (error) throw error;

    const rows = history || [];
    const priorSuccessfulPayments = rows.filter(
        (row) => row.status === "recovered" && row.id !== payment.id
    ).length;

    const earliestMs = rows.reduce((min, row) => {
        const t = new Date(row.created_at).getTime();
        return Number.isFinite(t) && t < min ? t : min;
    }, new Date(payment.created_at).getTime());

    const accountAgeDays = Math.max(0, Math.floor((Date.now() - earliestMs) / (1000 * 60 * 60 * 24)));

    return { accountAgeDays, priorSuccessfulPayments };
}

/**
 * Builds the exact request body ml/app.py's PredictRequest expects from a
 * payments row plus the derived customer context.
 */
function buildMlRequest(payment, context) {
    const previousAttempts = Math.max(Number(payment.previous_attempts) || 0, 0);

    return {
        amount: Number(payment.amount) || undefined,
        payment_method: mapWithFallback(PAYMENT_METHOD_MAP, payment.payment_method, "credit_card"),
        failure_reason: mapWithFallback(FAILURE_REASON_MAP, payment.failure_reason, "processing_error"),
        customer_segment: mapWithFallback(CUSTOMER_PATTERN_TO_SEGMENT, payment.customer_pattern, "returning"),
        account_age_days: context.accountAgeDays,
        prior_successful_payments: context.priorSuccessfulPayments,
        retry_attempt_number: Math.min(previousAttempts + 1, 10),
        hour_of_day: new Date().getHours()
    };
}

async function callMlPredict(requestBody) {
    if (!ML_SERVICE_URL) {
        throw new MlServiceError(
            "ML_SERVICE_URL is not configured",
            "ML_NOT_CONFIGURED",
            "The retry prediction service is not configured."
        );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ML_REQUEST_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(`${ML_SERVICE_URL}/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
    } catch (err) {
        if (err.name === "AbortError") {
            throw new MlServiceError(
                `ML service timed out after ${ML_REQUEST_TIMEOUT_MS}ms`,
                "ML_TIMEOUT",
                "The retry prediction service took too long to respond. Please try again."
            );
        }
        throw new MlServiceError(
            `Could not reach the ML service at ${ML_SERVICE_URL}: ${err.message}`,
            "ML_UNAVAILABLE",
            "The retry prediction service is currently unavailable. Please try again shortly."
        );
    } finally {
        clearTimeout(timeout);
    }

    let body = null;
    try {
        body = await response.json();
    } catch {
        // No JSON body — treated as a bad response below.
    }

    if (!response.ok) {
        const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
        throw new MlServiceError(
            `ML service responded with ${response.status}: ${detail}`,
            response.status === 503 ? "ML_UNAVAILABLE" : "ML_BAD_RESPONSE",
            "The retry prediction service returned an error."
        );
    }

    if (!Array.isArray(body?.windows) || body.windows.length === 0) {
        throw new MlServiceError(
            "ML service response was missing prediction windows",
            "ML_BAD_RESPONSE",
            "The retry prediction service returned an unexpected response."
        );
    }

    return body;
}

/**
 * Public entry point used by routes/retry.js. Returns the same shape the
 * previous rule-based `predictRetryWindows(payment)` (services/retryEngine.js)
 * returned, so the route's DB writes and API response don't need to change
 * shape — only the numbers now come from the deployed model instead of a
 * hand-tuned curve.
 */
async function predictRetryWindowsWithMl(payment) {
    const context = await getCustomerContext(payment);
    const mlRequest = buildMlRequest(payment, context);

    console.log(`[mlService] POST ${ML_SERVICE_URL}/predict for payment ${payment.id}:`, JSON.stringify(mlRequest));
    const mlResponse = await callMlPredict(mlRequest);
    console.log(
        `[mlService] response for payment ${payment.id}: model=${mlResponse.model_version} ` +
            `recommended=${mlResponse.recommended_window} probability=${mlResponse.recommended_probability}`
    );

    const probabilities = {};
    for (const window of mlResponse.windows) {
        const key = WINDOW_LABEL_TO_KEY[window.window_label];
        if (key) probabilities[key] = Number(Number(window.probability).toFixed(4));
    }

    const recommendedWindow = WINDOW_LABEL_TO_KEY[mlResponse.recommended_window] || "retry_now";
    const recommendedWindowMeta = RETRY_WINDOWS.find((w) => w.key === recommendedWindow);
    const bestProbability = Number(Number(mlResponse.recommended_probability).toFixed(4));
    const amount = Number(payment.amount) || 0;
    const expectedRecoveryValue = Number(
        (mlResponse.recommended_expected_recovery_value ?? amount * bestProbability).toFixed(2)
    );

    // Risk score stays a policy/guardrail concern, computed the same way it
    // always was — it is not an ML prediction and must not come from the model.
    const riskScore = calculateRiskScore(payment);

    const explanation =
        `Recommended: ${recommendedWindowMeta?.label || recommendedWindow} ` +
        `(${Math.round(bestProbability * 100)}% predicted success, model ${mlResponse.model_version}). ` +
        "Prediction is based on payment method, failure reason, customer segment, account age, prior " +
        `successful payments, retry attempt number, and time of day. Overall risk score: ${riskScore}/100.`;

    return {
        probabilities,
        recommendedWindow,
        recommendedWindowLabel: recommendedWindowMeta?.label,
        bestProbability,
        expectedRecoveryValue,
        riskScore,
        explanation,
        mlMeta: {
            modelVersion: mlResponse.model_version,
            modelFingerprint: mlResponse.model_fingerprint,
            request: mlRequest,
            windows: mlResponse.windows
        }
    };
}

module.exports = {
    MlServiceError,
    predictRetryWindowsWithMl,
    buildMlRequest,
    getCustomerContext
};
