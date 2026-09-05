"""
RevRec AI - retry-timing model, v1.

Trains a classifier that predicts P(retry_success) for a failed payment
given its payment context and a candidate retry_window, then uses that
probability to recommend which of five retry windows to use and what the
expected recovered revenue (amount * P(success)) would be.

Reads data/payments.csv as-is. Does NOT modify or regenerate the dataset.

Usage:
    python scripts/train_retry_model.py
"""

import json
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

RANDOM_SEED = 42

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(BASE_DIR, "data", "payments.csv")
MODEL_DIR = os.path.join(BASE_DIR, "model")
PIPELINE_PATH = os.path.join(MODEL_DIR, "retry_success_pipeline.joblib")
METADATA_PATH = os.path.join(MODEL_DIR, "model_metadata.json")

TARGET = "retry_success"

# Payment-context features + retry_window_bucket (as required) + the
# concrete retry_window_minutes, so the model can distinguish retry windows
# that fall in the same bucket (e.g. "1h" vs "6h" are both "medium").
# None of these are computed from the target, and identifiers
# (transaction_id, customer_id) / raw timestamps (original_failure_at,
# retry_at) are excluded to avoid leakage/memorization and non-generalizable
# high-cardinality keys.
CATEGORICAL_FEATURES = [
    "payment_method",
    "customer_segment",
    "failure_reason",
    "retry_window_bucket",
]
NUMERIC_FEATURES = [
    "account_age_days",
    "prior_successful_payments",
    "transaction_amount",
    "retry_attempt_number",
    "hour_of_day",
    "retry_window_minutes",
]
FEATURES = CATEGORICAL_FEATURES + NUMERIC_FEATURES

# Friendly retry-window options exposed to the "recommend a window" step.
# Mapped to (retry_window_minutes, retry_window_bucket) using the same
# bucket edges the dataset generator used: immediate <5m, short 5-60m,
# medium 60m-24h, long 24h-7d.
RETRY_WINDOW_OPTIONS = [
    ("now", 2, "immediate"),
    ("15m", 15, "short"),
    ("1h", 60, "medium"),
    ("6h", 360, "medium"),
    ("tomorrow", 1440, "long"),
]


def load_data():
    df = pd.read_csv(DATA_PATH)
    return df


def check_class_balance(y, label):
    counts = y.value_counts().sort_index()
    total = len(y)
    print(f"\nClass balance ({label}):")
    for cls, n in counts.items():
        print(f"  {TARGET}={cls}: {n} ({n / total:.1%})")
    return counts


def build_pipeline():
    preprocessor = ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
            ("num", "passthrough", NUMERIC_FEATURES),
        ]
    )
    clf = RandomForestClassifier(
        n_estimators=300,
        max_depth=None,
        min_samples_leaf=5,
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )
    return Pipeline(steps=[("preprocess", preprocessor), ("clf", clf)])


def evaluate(pipeline, X_test, y_test):
    y_pred = pipeline.predict(X_test)
    y_proba = pipeline.predict_proba(X_test)[:, 1]

    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "precision": precision_score(y_test, y_pred),
        "recall": recall_score(y_test, y_pred),
        "f1": f1_score(y_test, y_pred),
        "roc_auc": roc_auc_score(y_test, y_proba),
        "log_loss": log_loss(y_test, y_proba),
    }
    cm = confusion_matrix(y_test, y_pred)
    return metrics, cm


def get_feature_names(pipeline):
    preprocessor = pipeline.named_steps["preprocess"]
    cat_names = list(preprocessor.named_transformers_["cat"].get_feature_names_out(CATEGORICAL_FEATURES))
    return cat_names + NUMERIC_FEATURES


def print_feature_importance(pipeline, top_n=15):
    names = get_feature_names(pipeline)
    importances = pipeline.named_steps["clf"].feature_importances_
    order = np.argsort(importances)[::-1]
    print(f"\nTop {top_n} feature importances:")
    for idx in order[:top_n]:
        print(f"  {names[idx]:35s} {importances[idx]:.4f}")


def build_example_context(df):
    """A representative bank-decline payment context, taken from the
    dataset's own feature distributions (median/mode), used to demo the
    five-retry-window comparison."""
    row = {
        "payment_method": "bank_transfer",
        "customer_segment": "returning",
        "failure_reason": "bank_decline_generic",
        "account_age_days": int(df.loc[df["customer_segment"] == "returning", "account_age_days"].median()),
        "prior_successful_payments": int(df.loc[df["customer_segment"] == "returning", "prior_successful_payments"].median()),
        "transaction_amount": 1500.0,  # RS 1,500 example payment
        "retry_attempt_number": 1,
        "hour_of_day": 14,
    }
    return row


def predict_across_windows(pipeline, context, amount):
    rows = []
    for label, minutes, bucket in RETRY_WINDOW_OPTIONS:
        row = dict(context)
        row["retry_window_minutes"] = minutes
        row["retry_window_bucket"] = bucket
        rows.append(row)
    X = pd.DataFrame(rows)[FEATURES]
    proba = pipeline.predict_proba(X)[:, 1]

    results = []
    for (label, minutes, bucket), p in zip(RETRY_WINDOW_OPTIONS, proba):
        results.append({
            "window_label": label,
            "retry_window_minutes": minutes,
            "retry_window_bucket": bucket,
            "predicted_success_probability": float(p),
            "expected_recovery_value": float(amount) * float(p),
        })
    return results


def main():
    print(f"Loading dataset from {DATA_PATH}")
    df = load_data()
    print(f"Dataset size: {len(df)} rows, {len(df.columns)} columns")

    y_full = df[TARGET]
    check_class_balance(y_full, "full dataset")

    X = df[FEATURES].copy()
    y = df[TARGET].copy()

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_SEED, stratify=y
    )
    print(f"\nTrain size: {len(X_train)}  Test size: {len(X_test)}")
    check_class_balance(y_train, "train split")
    check_class_balance(y_test, "test split")

    pipeline = build_pipeline()
    pipeline.fit(X_train, y_train)

    metrics, cm = evaluate(pipeline, X_test, y_test)
    print("\nEvaluation metrics (test set):")
    for k, v in metrics.items():
        print(f"  {k:10s}: {v:.4f}")
    print("\nConfusion matrix (rows=actual, cols=predicted, [0,1]):")
    print(cm)

    print_feature_importance(pipeline)

    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(pipeline, PIPELINE_PATH)

    metadata = {
        "random_seed": RANDOM_SEED,
        "target": TARGET,
        "categorical_features": CATEGORICAL_FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "features": FEATURES,
        "excluded_columns": [
            "transaction_id", "customer_id", "original_failure_at", "retry_at",
            "time_of_day_bucket", "retry_success",
        ],
        "dataset_size": len(df),
        "class_distribution": y_full.value_counts().sort_index().to_dict(),
        "train_size": len(X_train),
        "test_size": len(X_test),
        "model": "RandomForestClassifier",
        "model_params": pipeline.named_steps["clf"].get_params(),
        "metrics": metrics,
        "confusion_matrix": cm.tolist(),
        "retry_window_options": RETRY_WINDOW_OPTIONS,
    }
    with open(METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, default=str)

    print(f"\nSaved pipeline to {PIPELINE_PATH}")
    print(f"Saved metadata to {METADATA_PATH}")

    # ---- Demo: same payment context, five retry windows ----
    example_amount = 1500.0
    context = build_example_context(df)
    print("\nExample payment context (Rs 1,500, bank_decline_generic):")
    for k, v in context.items():
        print(f"  {k}: {v}")

    results = predict_across_windows(pipeline, context, example_amount)
    print("\nPredicted success probability & expected recovery value by retry window:")
    print(f"  {'window':10s} {'minutes':>8s} {'bucket':10s} {'P(success)':>12s} {'expected_recovery':>18s}")
    for r in results:
        print(
            f"  {r['window_label']:10s} {r['retry_window_minutes']:8d} "
            f"{r['retry_window_bucket']:10s} {r['predicted_success_probability']:12.4f} "
            f"{r['expected_recovery_value']:18.2f}"
        )

    best = max(results, key=lambda r: r["predicted_success_probability"])
    print(
        f"\nRecommended retry window: {best['window_label']} "
        f"(P(success)={best['predicted_success_probability']:.4f}, "
        f"expected recovery value=Rs {best['expected_recovery_value']:.2f})"
    )

    unique_probs = {round(r["predicted_success_probability"], 6) for r in results}
    print(f"\nDistinct predicted probabilities across the 5 windows: {len(unique_probs)} / 5")


if __name__ == "__main__":
    main()
