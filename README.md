# RevRec AI

AI-powered payment recovery platform. When a payment fails, RevRec AI predicts the retry window with the highest chance of success (using a trained ML model), lets you validate/execute the retry through Razorpay, and tracks the full recovery lifecycle on a live dashboard.

## Live Deployments

| Service | URL | Stack |
|---|---|---|
| Frontend | https://revrec-ai-lovat.vercel.app/ | React 19 + Vite (Vercel) |
| Backend API | https://revrec-ai-backend.onrender.com | Node.js + Express 5 (Render) |
| ML Service | https://revrec-ai.onrender.com | FastAPI + scikit-learn (Render) |
| Database | Supabase (Postgres) | — |
| Payments | Razorpay (test mode) | — |

## Architecture

```
Frontend (React/Vite)  ──►  Backend (Express)  ──►  Supabase (Postgres)
        │                        │      │
        │                        │      └──► ML Service (FastAPI) — retry success prediction
        │                        └──► Razorpay — create order / webhook (payment.failed, payment.captured)
        └──────────────────────────────────────────────────────────────────────────────────►  (talks only to backend)
```

- **Frontend** calls the backend via `VITE_API_URL`.
- **Backend** calls the ML service via `ML_SERVICE_URL` for retry-timing predictions and writes results to Supabase.
- **Razorpay** sends webhooks to the backend (`/api/webhooks/razorpay`) on payment success/failure.

## Features

- **Dashboard** — recovery KPIs, revenue at risk, and recent activity.
- **Payment Failures** — list/detail view of failed payments with customer and failure-reason context.
- **Retry Intelligence** — ML-recommended retry window (now / 15m / 1h / 6h / tomorrow) with success probability and expected recovery value per window.
- **Test Payment Lab** — simulate payments/failures end-to-end against Razorpay test mode.
- **Recovery messaging** — generate customer-facing recovery messages per payment.

## Repo Structure

```
backend/    Express API — routes, services (ML client, retry engine, policy), Supabase config, schema.sql
frontend/   React + Vite SPA — pages (Dashboard, PaymentFailures, RetryIntelligence, TestPaymentLab), components
ml/         FastAPI inference service + model training scripts/dataset (app.py, model/, scripts/, DATASET.md)
```

## Tech Stack

- **Frontend:** React 19, React Router, Vite, lucide-react
- **Backend:** Node.js, Express 5, Supabase JS client, Razorpay SDK, ws
- **ML:** Python, FastAPI, scikit-learn, pandas, joblib (`revrec-retry-timing-rf-v1` model)
- **Database:** Supabase (Postgres) — `payments`, `retry_predictions`, `payment_events`
- **Deployment:** Vercel (frontend), Render (backend + ML service)

## API Overview (backend)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/payments` | List failed payments |
| GET | `/api/payments/:id` | Payment detail |
| GET | `/api/dashboard` | Dashboard summary stats |
| POST | `/api/retry/predict/:paymentId` | Get ML retry-window prediction |
| POST | `/api/retry/validate/:paymentId` | Validate a chosen retry window |
| POST | `/api/retry/execute/:paymentId` | Execute the retry via Razorpay |
| POST | `/api/razorpay/create-order` | Create a Razorpay order |
| POST | `/api/webhooks/razorpay` | Razorpay webhook receiver |
| POST | `/api/recovery/message/:paymentId` | Generate a recovery message |
| GET | `/api/test-db` | Supabase connectivity check |

## Local Development

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in Supabase, Razorpay, ML_SERVICE_URL
npm run dev             # http://localhost:5000
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env    # set VITE_API_URL=http://localhost:5000 for local dev
npm run dev              # http://localhost:5173
```

### 3. ML Service

```bash
cd ml
pip install -r requirements.txt
python -m uvicorn app:app --reload --port 8000
```

Model is pre-trained (`ml/model/retry_success_pipeline.joblib`); see `ml/DATASET.md` and `ml/scripts/` to retrain.

## Environment Variables

**backend/.env**
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PORT=5000
ML_SERVICE_URL=https://revrec-ai.onrender.com
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

**frontend/.env**
```
VITE_API_URL=https://revrec-ai-backend.onrender.com
```

## Database

Run `backend/schema.sql` in the Supabase SQL editor to create/verify the `payments`, `retry_predictions`, and `payment_events` tables and grants.
