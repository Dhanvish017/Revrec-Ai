import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react'
import Timeline from '../components/Timeline'
import AsyncState from '../components/AsyncState'
import { api, ApiError } from '../services/api'
import {
  EVENT_TYPE_META,
  RETRY_WINDOW_LABELS,
  RETRY_WINDOW_ORDER,
  formatCurrency,
  formatPercent,
  humanize,
} from '../utils/format'
import './RetryIntelligence.css'

const emptyAnalysis = { paymentId: null, loading: false, error: null, prediction: null, events: [] }

export default function RetryIntelligence() {
  const [payments, setPayments] = useState([])
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [paymentsError, setPaymentsError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const [analysis, setAnalysis] = useState(emptyAnalysis)
  const [analysisRetryToken, setAnalysisRetryToken] = useState(0)
  const [windowOverride, setWindowOverride] = useState(null)
  const [validation, setValidation] = useState(null)
  const [execution, setExecution] = useState(null)

  const loadPayments = () => {
    setPaymentsLoading(true)
    setPaymentsError(null)
    api
      .getPayments()
      .then((data) => {
        setPayments(data || [])
        setSelectedId((current) => current ?? data?.[0]?.id ?? null)
      })
      .catch((err) => setPaymentsError(err instanceof ApiError ? err.message : 'Failed to load payments.'))
      .finally(() => setPaymentsLoading(false))
  }

  useEffect(loadPayments, [])

  // The core Retry Intelligence call: whenever a payment is selected, ask
  // the backend to predict retry-window success probabilities for it.
  useEffect(() => {
    if (!selectedId) {
      setAnalysis(emptyAnalysis)
      return
    }
    let cancelled = false
    setAnalysis({ paymentId: selectedId, loading: true, error: null, prediction: null, events: [] })
    Promise.all([api.predictRetry(selectedId), api.getPayment(selectedId)])
      .then(([predictionData, detailData]) => {
        if (cancelled) return
        setAnalysis({
          paymentId: selectedId,
          loading: false,
          error: null,
          prediction: predictionData,
          events: detailData?.events || [],
        })
      })
      .catch((err) => {
        if (cancelled) return
        setAnalysis({
          paymentId: selectedId,
          loading: false,
          error: err instanceof ApiError ? err.message : 'Failed to analyze this payment.',
          prediction: null,
          events: [],
        })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, analysisRetryToken])

  const refreshEvents = () => {
    if (!selectedId) return
    api
      .getPayment(selectedId)
      .then((d) => setAnalysis((a) => (a.paymentId === selectedId ? { ...a, events: d?.events || [] } : a)))
      .catch(() => {})
  }

  const payment = payments.find((p) => p.id === selectedId) || null
  const prediction = analysis.paymentId === selectedId ? analysis.prediction : null
  const currentValidation = validation?.paymentId === selectedId ? validation : null
  const currentExecution = execution?.paymentId === selectedId ? execution : null

  const selectedWindow =
    windowOverride?.paymentId === selectedId ? windowOverride.windowKey : prediction?.recommendedWindow
  const maxProbability = prediction
    ? Math.max(...RETRY_WINDOW_ORDER.map((k) => prediction.probabilities[k] || 0), 0.01)
    : 1

  const selectWindow = (windowKey) => setWindowOverride({ paymentId: selectedId, windowKey })

  const handleValidate = () => {
    setValidation({ paymentId: selectedId, loading: true, error: null, data: null })
    api
      .validateRetry(selectedId)
      .then((data) => setValidation({ paymentId: selectedId, loading: false, error: null, data }))
      .catch((err) =>
        setValidation({
          paymentId: selectedId,
          loading: false,
          error: err instanceof ApiError ? err.message : 'Validation failed.',
          data: null,
        })
      )
  }

  const handleExecute = () => {
    setExecution({ paymentId: selectedId, loading: true, error: null, data: null })
    api
      .executeRetry(selectedId)
      .then((data) => {
        setExecution({ paymentId: selectedId, loading: false, error: null, data })
        loadPayments()
        if (data.executed) refreshEvents()
      })
      .catch((err) =>
        setExecution({
          paymentId: selectedId,
          loading: false,
          error: err instanceof ApiError ? err.message : 'Retry execution failed.',
          data: null,
        })
      )
  }

  const explanationSentences = prediction?.explanation
    ? prediction.explanation.split('. ').map((s) => s.trim().replace(/\.$/, '')).filter(Boolean)
    : []

  return (
    <div className="page">
      <div className="card ri-selector-card">
        <div className="card-header">
          <h2>Failed payment</h2>
          <span className="badge badge-info"><Sparkles size={12} />Backend-powered</span>
        </div>
        <div className="card-body ri-selector-body">
          {(paymentsLoading || paymentsError || payments.length === 0) ? (
            <AsyncState
              loading={paymentsLoading}
              error={paymentsError}
              onRetry={loadPayments}
              empty={!paymentsLoading && !paymentsError && payments.length === 0}
              loadingText="Loading payments…"
              emptyText="No payments yet — create one in the Test Payment Lab first."
              compact
            />
          ) : (
            <>
              <select
                className="select ri-select"
                value={selectedId || ''}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {payments.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.payment_id || p.id} — {p.customer_name} — {formatCurrency(p.amount, p.currency)}
                  </option>
                ))}
              </select>
              {payment && (
                <div className="ri-selector-summary">
                  <span className="mono text-muted">{payment.payment_id || payment.id}</span>
                  <span className="text-faint">•</span>
                  <span>{payment.customer_name}</span>
                  <span className="text-faint">•</span>
                  <span>{formatCurrency(payment.amount, payment.currency)}</span>
                  <span className="text-faint">•</span>
                  <span className="badge badge-neutral">{humanize(payment.status)}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {payment && (
        <>
          <div className="card">
            <div className="card-header">
              <h2>Payment details</h2>
            </div>
            <div className="card-body">
              <div className="drawer-kv">
                <span>Amount</span>
                <span>{formatCurrency(payment.amount, payment.currency)}</span>
              </div>
              <div className="drawer-kv">
                <span>Payment method</span>
                <span>{humanize(payment.payment_method)}</span>
              </div>
              <div className="drawer-kv">
                <span>Failure reason</span>
                <span>{humanize(payment.failure_reason)}</span>
              </div>
              <div className="drawer-kv">
                <span>Customer</span>
                <span>{payment.customer_name}</span>
              </div>
              <div className="drawer-kv">
                <span>Customer pattern</span>
                <span>{humanize(payment.customer_pattern)}</span>
              </div>
              <div className="drawer-kv">
                <span>Previous attempts</span>
                <span>{payment.previous_attempts}</span>
              </div>
              <div className="drawer-kv">
                <span>Risk score</span>
                <span>{payment.risk_score} / 100</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>ML retry prediction</h2>
              <span className="text-muted">Predicted success probability by retry window</span>
            </div>

            {analysis.loading || analysis.error ? (
              <AsyncState
                loading={analysis.loading}
                error={analysis.error}
                onRetry={() => setAnalysisRetryToken((t) => t + 1)}
                loadingText="Calling POST /api/retry/predict…"
              />
            ) : prediction && (
              <>
                <div className="ri-highlight-row">
                  <div className="ri-highlight-tile">
                    <span className="text-faint">Recommended retry time</span>
                    <strong><CalendarClock size={15} /> {prediction.recommendedWindowLabel || RETRY_WINDOW_LABELS[prediction.recommendedWindow]}</strong>
                  </div>
                  <div className="ri-highlight-tile">
                    <span className="text-faint">Predicted success probability</span>
                    <strong className="ri-highlight-value">{formatPercent(prediction.bestProbability)}</strong>
                  </div>
                  <div className="ri-highlight-tile">
                    <span className="text-faint">Expected recovery value</span>
                    <strong className="ri-highlight-value">{formatCurrency(prediction.expectedRecoveryValue, payment.currency)}</strong>
                  </div>
                </div>

                <div className="ri-bars">
                  {RETRY_WINDOW_ORDER.map((key) => {
                    const probability = prediction.probabilities[key] || 0
                    const isRecommended = key === prediction.recommendedWindow
                    const isSelected = key === selectedWindow
                    return (
                      <button
                        type="button"
                        key={key}
                        className={`ri-bar-row${isRecommended ? ' recommended' : ''}${isSelected ? ' selected' : ''}`}
                        onClick={() => selectWindow(key)}
                      >
                        <div className="ri-bar-label">
                          <span>{RETRY_WINDOW_LABELS[key]}</span>
                          {isRecommended && <span className="badge badge-success ri-bar-badge"><Sparkles size={10} />Best window</span>}
                        </div>
                        <div className="ri-bar-track">
                          <div
                            className="ri-bar-fill"
                            style={{ width: `${(probability / maxProbability) * 100}%` }}
                          />
                        </div>
                        <div className="ri-bar-values">
                          <span className="ri-bar-probability">{formatPercent(probability)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <p className="ri-bars-hint text-faint">
                  The backend currently executes retries immediately using the "Retry Now" probability; other windows are shown here for comparison.
                </p>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Why this recommendation?</h2>
            </div>
            <div className="ri-explanation">
              {analysis.loading ? (
                <AsyncState loading compact loadingText="Generating explanation…" />
              ) : prediction ? (
                <ul className="ri-explanation-list">
                  {explanationSentences.map((sentence, i) => (
                    <li key={i}>{sentence}.</li>
                  ))}
                </ul>
              ) : (
                <p className="text-faint">Select a payment to see the backend's explanation.</p>
              )}
            </div>
          </div>

          {analysis.events.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2>Recent activity</h2>
              </div>
              <div className="card-body">
                <Timeline
                  items={analysis.events.map((e) => ({
                    id: e.id,
                    label: EVENT_TYPE_META[e.event_type]?.label || humanize(e.event_type),
                    timestamp: e.created_at,
                    type: EVENT_TYPE_META[e.event_type]?.type || 'info',
                  }))}
                  dense
                />
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h2>Policy &amp; guardrails</h2>
              {currentValidation?.data && (
                <span className={`badge ${currentValidation.data.decision === 'APPROVED' ? 'badge-success' : 'badge-danger'}`}>
                  <span className="badge-dot" />
                  {currentValidation.data.decision}
                </span>
              )}
            </div>
            <div className="ri-guardrails-body">
              <button type="button" className="btn" onClick={handleValidate} disabled={currentValidation?.loading}>
                {currentValidation?.loading ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
                Validate guardrails
              </button>

              {currentValidation?.error && (
                <div className="ri-action-result danger">
                  <AlertCircle size={15} />
                  {currentValidation.error}
                </div>
              )}

              {currentValidation?.data && (
                <div className="ri-guardrails">
                  {currentValidation.data.reasons.length === 0 ? (
                    <div className="ri-guardrail">
                      <CheckCircle2 size={17} strokeWidth={2} className="ri-guardrail-icon pass" />
                      <div>
                        <span className="ri-guardrail-label">All checks passed</span>
                        <p className="text-muted">Risk score {currentValidation.data.riskScore} / 100 — this payment is eligible for an automated retry.</p>
                      </div>
                    </div>
                  ) : (
                    currentValidation.data.reasons.map((reason, i) => (
                      <div className="ri-guardrail failed" key={i}>
                        <XCircle size={17} strokeWidth={2} className="ri-guardrail-icon fail" />
                        <div>
                          <span className="ri-guardrail-label">Blocked</span>
                          <p className="text-muted">{reason}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="card ri-actions-card">
            <p className="text-muted">
              Executing calls <code>POST /api/retry/execute</code>, which re-validates guardrails server-side, then
              simulates the outcome using the current "Retry Now" success probability.
            </p>
            <div className="ri-actions-buttons">
              <button type="button" className="btn btn-primary" onClick={handleExecute} disabled={currentExecution?.loading}>
                {currentExecution?.loading ? <Loader2 size={15} className="spin" /> : <PlayCircle size={15} />}
                Execute retry
              </button>
            </div>

            {currentExecution?.error && (
              <div className="ri-action-result danger">
                <AlertCircle size={15} />
                {currentExecution.error}
              </div>
            )}

            {currentExecution?.data && !currentExecution.data.executed && (
              <div className="ri-action-result danger">
                <XCircle size={15} />
                Blocked: {currentExecution.data.reasons.join(' ')}
              </div>
            )}

            {currentExecution?.data?.executed && (
              <div className={`ri-action-result ${currentExecution.data.outcome === 'RECOVERED' ? 'success' : 'danger'}`}>
                {currentExecution.data.outcome === 'RECOVERED' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                {currentExecution.data.outcome === 'RECOVERED'
                  ? <>Retry succeeded — <strong>{formatCurrency(currentExecution.data.payment.amount, currentExecution.data.payment.currency)}</strong> recovered. Status is now <strong>{humanize(currentExecution.data.payment.status)}</strong>.</>
                  : <>Retry did not succeed this time. Attempts is now <strong>{currentExecution.data.payment.previous_attempts}</strong> — try validating and executing again later.</>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
