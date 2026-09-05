"""
Synthetic payment-retry dataset generator.

Generates a CSV of failed-payment retry events with deliberately engineered
relationships between payment_method, failure_reason, customer history,
time of day, retry window, and retry_success -- so the dataset is useful
for training/evaluating a retry-success classifier, not just random noise.

Usage:
    python scripts/generate_dataset.py

All randomness is drawn from a single seeded random.Random instance, so
re-running this script produces byte-identical output.

See DATASET.md for the full list of assumptions encoded here.
"""

import csv
import math
import os
import random
from datetime import datetime, timedelta

SEED = 42
N_ROWS = 12000
N_CUSTOMERS = 4000

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "payments.csv")

rng = random.Random(SEED)

# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

PAYMENT_METHODS = ["credit_card", "debit_card", "paypal", "bank_transfer", "digital_wallet", "upi"]
PAYMENT_METHOD_WEIGHTS = [0.35, 0.25, 0.15, 0.10, 0.08, 0.07]

FAILURE_REASONS = [
    "insufficient_funds",
    "expired_card",
    "incorrect_cvv",
    "network_error",
    "processing_error",
    "fraud_suspected",
    "bank_decline_generic",
    "card_not_activated",
]
# overall base share of each failure reason before method/segment/time adjustment
FAILURE_BASE_WEIGHTS = {
    "insufficient_funds": 0.22,
    "expired_card": 0.10,
    "incorrect_cvv": 0.15,
    "network_error": 0.13,
    "processing_error": 0.12,
    "fraud_suspected": 0.05,
    "bank_decline_generic": 0.15,
    "card_not_activated": 0.08,
}
# base P(retry succeeds) at reference conditions: credit_card, returning
# customer, business-hours retry, 1st attempt, medium retry window
FAILURE_BASE_PROB = {
    "insufficient_funds": 0.30,
    "expired_card": 0.08,
    "incorrect_cvv": 0.55,
    "network_error": 0.80,
    "processing_error": 0.65,
    "fraud_suspected": 0.04,
    "bank_decline_generic": 0.35,
    "card_not_activated": 0.40,
}

SEGMENTS = ["new", "returning", "loyal"]
SEGMENT_WEIGHTS = [0.30, 0.50, 0.20]

# multiplicative weight adjustments applied to FAILURE_BASE_WEIGHTS
METHOD_REASON_MULT = {
    "credit_card": {"expired_card": 1.5, "insufficient_funds": 1.2, "fraud_suspected": 1.2},
    "debit_card": {"insufficient_funds": 1.6, "incorrect_cvv": 1.1},
    "paypal": {"fraud_suspected": 0.5, "network_error": 0.8, "processing_error": 1.1},
    "bank_transfer": {
        "processing_error": 1.8, "network_error": 1.4, "bank_decline_generic": 1.3,
        "insufficient_funds": 0.6, "incorrect_cvv": 0.2, "expired_card": 0.1,
    },
    "digital_wallet": {"network_error": 1.3, "card_not_activated": 1.5, "incorrect_cvv": 0.3},
    "upi": {"network_error": 1.6, "processing_error": 1.3, "incorrect_cvv": 0.1, "expired_card": 0.05},
}
SEGMENT_REASON_MULT = {
    "new": {"incorrect_cvv": 1.4, "fraud_suspected": 1.8, "expired_card": 0.5},
    "returning": {},
    "loyal": {"expired_card": 1.5, "insufficient_funds": 1.2, "fraud_suspected": 0.4},
}
TIME_REASON_MULT = {
    "night": {"network_error": 1.8, "processing_error": 1.5, "bank_decline_generic": 1.2},
    "morning": {"processing_error": 1.2, "network_error": 1.2},
    "afternoon": {},
    "evening": {"incorrect_cvv": 1.1, "fraud_suspected": 1.1},
}

# logit-space adjustments to P(retry_success)
METHOD_SUCCESS_LOGIT = {
    "credit_card": 0.0, "debit_card": -0.2, "paypal": 0.3,
    "bank_transfer": -0.4, "digital_wallet": 0.25, "upi": 0.35,
}
SEGMENT_SUCCESS_LOGIT = {"new": -0.5, "returning": 0.0, "loyal": 0.4}
TIME_SUCCESS_LOGIT = {"night": -0.5, "morning": -0.3, "afternoon": 0.0, "evening": -0.1}
ATTEMPT_SUCCESS_LOGIT = {1: 0.0, 2: -0.3, 3: -0.6}

# retry_window_bucket ranges (minutes) and sampling weights
WINDOW_BUCKETS = [
    ("immediate", 1, 5, 0.40),
    ("short", 5, 60, 0.30),
    ("medium", 60, 1440, 0.20),
    ("long", 1440, 10080, 0.10),
]

# logit-space bonus/penalty per (failure_reason, window_bucket) -- encodes
# that some failures need time to resolve (insufficient_funds, expired_card,
# card_not_activated) while others are best retried immediately (transient
# network/processing errors, simple user-entry mistakes)
REASON_WINDOW_LOGIT = {
    "insufficient_funds": {"immediate": -1.0, "short": -0.5, "medium": 0.3, "long": 0.8},
    "expired_card": {"immediate": -0.5, "short": -0.3, "medium": 0.0, "long": 0.5},
    "incorrect_cvv": {"immediate": 0.4, "short": 0.2, "medium": 0.0, "long": -0.3},
    "network_error": {"immediate": 0.8, "short": 0.4, "medium": -0.2, "long": -0.6},
    "processing_error": {"immediate": 0.6, "short": 0.3, "medium": -0.1, "long": -0.4},
    "fraud_suspected": {"immediate": -0.2, "short": -0.1, "medium": 0.0, "long": 0.1},
    "bank_decline_generic": {"immediate": -0.2, "short": 0.0, "medium": 0.2, "long": 0.1},
    "card_not_activated": {"immediate": -0.8, "short": -0.4, "medium": 0.3, "long": 0.9},
}

ATTEMPT_WEIGHTS = [(1, 0.60), (2, 0.30), (3, 0.10)]

# hour-of-day sampling weights: fewer failures overnight, peak in the evening
HOUR_WEIGHTS = [
    1, 1, 1, 1, 1, 2,        # 0-5   night
    3, 4, 5, 6, 6, 6,        # 6-11  morning
    6, 6, 7, 7, 6, 6,        # 12-17 afternoon
    7, 8, 8, 7, 5, 3,        # 18-23 evening
]

DATASET_START = datetime(2025, 1, 1)
DATASET_END = datetime(2025, 6, 30)
DATASET_SPAN_SECONDS = int((DATASET_END - DATASET_START).total_seconds())


def hour_to_bucket(hour):
    if 0 <= hour < 6:
        return "night"
    if 6 <= hour < 12:
        return "morning"
    if 12 <= hour < 18:
        return "afternoon"
    return "evening"


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


def weighted_choice(rng_, items, weights):
    return rng_.choices(items, weights=weights, k=1)[0]


def build_customers():
    """Pre-generate a fixed pool of customers with stable history attributes."""
    customers = []
    for i in range(N_CUSTOMERS):
        segment = weighted_choice(rng, SEGMENTS, SEGMENT_WEIGHTS)
        if segment == "new":
            account_age_days = rng.randint(0, 90)
            prior_successful_payments = rng.randint(0, 2)
        elif segment == "returning":
            account_age_days = rng.randint(91, 720)
            prior_successful_payments = rng.randint(3, 20)
        else:  # loyal
            account_age_days = rng.randint(721, 3000)
            prior_successful_payments = rng.randint(21, 200)

        preferred_method = weighted_choice(rng, PAYMENT_METHODS, PAYMENT_METHOD_WEIGHTS)
        # loyal / longer-tenured customers transact (and therefore appear in
        # this failed-payment log) more often than brand-new customers
        activity_weight = 1.0 + prior_successful_payments / 50.0

        customers.append({
            "customer_id": f"C{i + 1:05d}",
            "segment": segment,
            "account_age_days": account_age_days,
            "prior_successful_payments": prior_successful_payments,
            "preferred_method": preferred_method,
            "activity_weight": activity_weight,
        })
    return customers


def pick_failure_reason(payment_method, segment, time_bucket):
    weights = []
    for reason in FAILURE_REASONS:
        w = FAILURE_BASE_WEIGHTS[reason]
        w *= METHOD_REASON_MULT.get(payment_method, {}).get(reason, 1.0)
        w *= SEGMENT_REASON_MULT.get(segment, {}).get(reason, 1.0)
        w *= TIME_REASON_MULT.get(time_bucket, {}).get(reason, 1.0)
        weights.append(w)
    return weighted_choice(rng, FAILURE_REASONS, weights)


def pick_window():
    names = [b[0] for b in WINDOW_BUCKETS]
    weights = [b[3] for b in WINDOW_BUCKETS]
    bucket = weighted_choice(rng, names, weights)
    lo, hi = next((b[1], b[2]) for b in WINDOW_BUCKETS if b[0] == bucket)
    # log-uniform within the bucket so most values sit toward the low end
    # while still allowing occasional long waits
    minutes = int(round(math.exp(rng.uniform(math.log(lo), math.log(hi)))))
    return bucket, minutes


def main():
    customers = build_customers()
    customer_weights = [c["activity_weight"] for c in customers]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    fieldnames = [
        "transaction_id", "customer_id", "customer_segment", "account_age_days",
        "prior_successful_payments", "payment_method", "transaction_amount",
        "original_failure_at", "failure_reason", "retry_attempt_number",
        "retry_window_minutes", "retry_window_bucket", "retry_at",
        "hour_of_day", "time_of_day_bucket", "retry_success",
    ]

    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for i in range(N_ROWS):
            customer = rng.choices(customers, weights=customer_weights, k=1)[0]

            # 90% of the time the customer retries with their usual method;
            # 10% of the time they switch to a different one
            if rng.random() < 0.90:
                payment_method = customer["preferred_method"]
            else:
                payment_method = weighted_choice(rng, PAYMENT_METHODS, PAYMENT_METHOD_WEIGHTS)

            offset_seconds = rng.randint(0, DATASET_SPAN_SECONDS)
            base_time = DATASET_START + timedelta(seconds=offset_seconds)
            hour = weighted_choice(rng, list(range(24)), HOUR_WEIGHTS)
            original_failure_at = base_time.replace(
                hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59)
            )
            time_bucket = hour_to_bucket(hour)

            failure_reason = pick_failure_reason(payment_method, customer["segment"], time_bucket)
            window_bucket, window_minutes = pick_window()
            retry_at = original_failure_at + timedelta(minutes=window_minutes)
            attempt = weighted_choice(rng, [a for a, _ in ATTEMPT_WEIGHTS], [w for _, w in ATTEMPT_WEIGHTS])

            base_p = FAILURE_BASE_PROB[failure_reason]
            base_logit = math.log(base_p / (1 - base_p))
            logit = (
                base_logit
                + METHOD_SUCCESS_LOGIT[payment_method]
                + SEGMENT_SUCCESS_LOGIT[customer["segment"]]
                + TIME_SUCCESS_LOGIT[time_bucket]
                + ATTEMPT_SUCCESS_LOGIT[attempt]
                + REASON_WINDOW_LOGIT[failure_reason][window_bucket]
                + rng.gauss(0, 0.3)
            )
            p_success = sigmoid(logit)
            retry_success = 1 if rng.random() < p_success else 0

            transaction_amount = round(rng.lognormvariate(3.9, 0.7), 2)  # median ~ $49

            writer.writerow({
                "transaction_id": f"T{i + 1:07d}",
                "customer_id": customer["customer_id"],
                "customer_segment": customer["segment"],
                "account_age_days": customer["account_age_days"],
                "prior_successful_payments": customer["prior_successful_payments"],
                "payment_method": payment_method,
                "transaction_amount": transaction_amount,
                "original_failure_at": original_failure_at.isoformat(),
                "failure_reason": failure_reason,
                "retry_attempt_number": attempt,
                "retry_window_minutes": window_minutes,
                "retry_window_bucket": window_bucket,
                "retry_at": retry_at.isoformat(),
                "hour_of_day": hour,
                "time_of_day_bucket": time_bucket,
                "retry_success": retry_success,
            })

    print(f"Wrote {N_ROWS} rows to {os.path.abspath(OUT_PATH)}")


if __name__ == "__main__":
    main()
