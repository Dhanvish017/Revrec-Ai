"""
RevRec AI - retry-timing inference API.

Loads the already-trained model/retry_success_pipeline.joblib (produced by
scripts/train_retry_model.py) and exposes it over HTTP. Does not retrain,
does not touch the dataset, does not call out to any external ML service.

Run locally:
    python -m uvicorn app:app --reload --port 8000

Endpoints:
    GET  /health
    POST /predict
"""

import hashlib
import logging
import os
from contextlib import asynccontextmanager
from typing import Literal, Optional

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("revrec_ai")
logging.basicConfig(level=logging.INFO)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model", "retry_success_pipeline.joblib")

# Must match the feature set/order the pipeline was trained on
# (scripts/train_retry_model.py: CATEGORICAL_FEATURES + NUMERIC_FEATURES).
FEATURES = [
    "payment_method",
    "customer_segment",
    "failure_reason",
    "retry_window_bucket",
    "account_age_days",
    "prior_successful_payments",
    "transaction_amount",
    "retry_attempt_number",
    "hour_of_day",
    "retry_window_minutes",
]

PAYMENT_METHODS = ["credit_card", "debit_card", "paypal", "bank_transfer", "digital_wallet", "upi"]
FAILURE_REASONS = [
    "insufficient_funds", "expired_card", "incorrect_cvv", "network_error",
    "processing_error", "fraud_suspected", "bank_decline_generic", "card_not_activated",
]
CUSTOMER_SEGMENTS = ["new", "returning", "loyal"]

# The five retry windows evaluated for every request, and how each maps onto
# the (retry_window_minutes, retry_window_bucket) features the model expects.
# Bucket edges match the dataset generator: immediate <5m, short 5-60m,
# medium 60m-24h, long 24h-7d.
RETRY_WINDOW_OPTIONS = [
    ("now", 2, "immediate"),
    ("15m", 15, "short"),
    ("1h", 60, "medium"),
    ("6h", 360, "medium"),
    ("tomorrow", 1440, "long"),
]

MODEL_LABEL = "revrec-retry-timing-rf-v1"


def _file_fingerprint(path: str) -> Optional[str]:
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


state = {"pipeline": None, "model_fingerprint": None, "load_error": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        state["pipeline"] = joblib.load(MODEL_PATH)
        state["model_fingerprint"] = _file_fingerprint(MODEL_PATH)
        logger.info("Loaded model pipeline from %s (fingerprint=%s)", MODEL_PATH, state["model_fingerprint"])
    except Exception as exc:  # noqa: BLE001 - report at /health rather than crash-loop
        state["load_error"] = str(exc)
        logger.exception("Failed to load model pipeline from %s", MODEL_PATH)
    yield
    state["pipeline"] = None


app = FastAPI(title="RevRec AI - Retry Timing API", version="1.0.0", lifespan=lifespan)


class PredictRequest(BaseModel):
    amount: Optional[float] = Field(
        default=None, gt=0, description="Payment amount; when provided, expected recovery value is computed."
    )
    payment_method: Literal[tuple(PAYMENT_METHODS)] = Field(...)
    failure_reason: Literal[tuple(FAILURE_REASONS)] = Field(...)
    customer_segment: Literal[tuple(CUSTOMER_SEGMENTS)] = Field(...)
    account_age_days: int = Field(..., ge=0, le=20000)
    prior_successful_payments: int = Field(..., ge=0, le=100000)
    retry_attempt_number: int = Field(..., ge=1, le=10)
    hour_of_day: int = Field(..., ge=0, le=23)


class WindowPrediction(BaseModel):
    window_label: str
    retry_window_minutes: int
    retry_window_bucket: str
    probability: float
    expected_recovery_value: Optional[float] = None


class PredictResponse(BaseModel):
    model_version: str
    model_fingerprint: Optional[str]
    input: PredictRequest
    windows: list[WindowPrediction]
    recommended_window: str
    recommended_probability: float
    recommended_expected_recovery_value: Optional[float] = None


@app.get("/health")
def health():
    loaded = state["pipeline"] is not None
    return {
        "status": "ok" if loaded else "degraded",
        "model_loaded": loaded,
        "model_version": MODEL_LABEL,
        "model_fingerprint": state["model_fingerprint"],
        "model_path": MODEL_PATH,
        "load_error": state["load_error"],
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    pipeline = state["pipeline"]
    if pipeline is None:
        raise HTTPException(status_code=503, detail=f"Model not loaded: {state['load_error']}")

    try:
        base_row = {
            "payment_method": req.payment_method,
            "customer_segment": req.customer_segment,
            "failure_reason": req.failure_reason,
            "account_age_days": req.account_age_days,
            "prior_successful_payments": req.prior_successful_payments,
            "transaction_amount": req.amount if req.amount is not None else 0.0,
            "retry_attempt_number": req.retry_attempt_number,
            "hour_of_day": req.hour_of_day,
        }

        rows = []
        for _, minutes, bucket in RETRY_WINDOW_OPTIONS:
            row = dict(base_row)
            row["retry_window_minutes"] = minutes
            row["retry_window_bucket"] = bucket
            rows.append(row)

        X = pd.DataFrame(rows)[FEATURES]
        probabilities = pipeline.predict_proba(X)[:, 1]
    except Exception as exc:  # noqa: BLE001
        logger.exception("Prediction failed")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc

    windows: list[WindowPrediction] = []
    for (label, minutes, bucket), proba in zip(RETRY_WINDOW_OPTIONS, probabilities):
        expected_recovery = float(req.amount) * float(proba) if req.amount is not None else None
        windows.append(WindowPrediction(
            window_label=label,
            retry_window_minutes=minutes,
            retry_window_bucket=bucket,
            probability=float(proba),
            expected_recovery_value=expected_recovery,
        ))

    best = max(windows, key=lambda w: w.probability)

    return PredictResponse(
        model_version=MODEL_LABEL,
        model_fingerprint=state["model_fingerprint"],
        input=req,
        windows=windows,
        recommended_window=best.window_label,
        recommended_probability=best.probability,
        recommended_expected_recovery_value=best.expected_recovery_value,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    logger.exception("Unhandled exception")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
