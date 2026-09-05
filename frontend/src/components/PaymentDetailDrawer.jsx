import { useEffect } from 'react'
import { X } from 'lucide-react'
import StatusBadge from './StatusBadge'
import Timeline from './Timeline'
import AsyncState from './AsyncState'
import {
  EVENT_TYPE_META,
  RETRY_WINDOW_LABELS,
  formatCurrency,
  formatDateTime,
  formatPercent,
  humanize,
} from '../utils/format'
import './PaymentDetailDrawer.css'

const PREDICTION_WINDOW_COLUMNS = [
  { key: 'retry_now_probability', label: 'Now' },
  { key: 'retry_15min_probability', label: '+15m' },
  { key: 'retry_1hour_probability', label: '+1h' },
  { key: 'retry_6hour_probability', label: '+6h' },
  { key: 'retry_tomorrow_probability', label: 'Tomorrow' },
]

function describeEvent(event) {
  const data = event.event_data || {}
  switch (event.event_type) {
    case 'PAYMENT_FAILED':
      return `${humanize(data.failure_reason)} · ${humanize(data.payment_method)} · attempt ${data.previous_attempts ?? 0}`
    case 'ML_PREDICTION_CREATED':
      return `Recommended ${RETRY_WINDOW_LABELS[data.recommended_window] || humanize(data.recommended_window)} · ${formatPercent(data.best_probability)} predicted · ${formatCurrency(data.expected_recovery_value)} expected`
    case 'RETRY_EXECUTED':
      return `Attempt #${data.attempt_number} · ${formatPercent(data.success_probability)} success probability used`
    case 'PAYMENT_RECOVERED':
      return `Attempt #${data.attempt_number} · ${formatCurrency(data.amount)} recovered`
    case 'RETRY_ATTEMPT_FAILED':
      return `Attempt #${data.attempt_number} · retry did not succeed`
    case 'RECOVERY_MESSAGE_SENT':
      return `${humanize(data.channel)} · ${RETRY_WINDOW_LABELS[data.recommended_window] || humanize(data.recommended_window)} · Test Mode simulated`
    default:
      return Object.entries(data).map(([k, v]) => `${humanize(k)}: ${v}`).join(' · ') || undefined
  }
}

export default function PaymentDetailDrawer({ detail, loading, error, onRetry, onClose }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const showAsyncState = loading || error || !detail

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <p className="text-faint mono drawer-id">{detail?.payment_id || (loading ? 'Loading…' : '')}</p>
            <h2>{detail ? formatCurrency(detail.amount, detail.currency) : 'Payment details'}</h2>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body scrollbar-thin">
          {showAsyncState ? (
            <AsyncState
              loading={loading}
              error={error}
              onRetry={onRetry}
              loadingText="Loading payment details…"
            />
          ) : (
            <>
              <section className="drawer-section">
                <StatusBadge status={detail.status} />
              </section>

              <section className="drawer-section">
                <h3 className="drawer-section-title">Customer</h3>
                <div className="drawer-kv">
                  <span>Name</span>
                  <span>{detail.customer_name}</span>
                </div>
                <div className="drawer-kv">
                  <span>Email</span>
                  <span>{detail.customer_email}</span>
                </div>
                <div className="drawer-kv">
                  <span>Payment pattern</span>
                  <span>{humanize(detail.customer_pattern)}</span>
                </div>
              </section>

              <section className="drawer-section">
                <h3 className="drawer-section-title">Payment details</h3>
                <div className="drawer-kv">
                  <span>Method</span>
                  <span>{humanize(detail.payment_method)}</span>
                </div>
                <div className="drawer-kv">
                  <span>Failure reason</span>
                  <span>{humanize(detail.failure_reason)}</span>
                </div>
                <div className="drawer-kv">
                  <span>Previous attempts</span>
                  <span>{detail.previous_attempts}</span>
                </div>
                <div className="drawer-kv">
                  <span>Risk score</span>
                  <span>{detail.risk_score} / 100</span>
                </div>
                <div className="drawer-kv">
                  <span>Failed at</span>
                  <span>{formatDateTime(detail.created_at)}</span>
                </div>
                <div className="drawer-kv">
                  <span>Last updated</span>
                  <span>{formatDateTime(detail.updated_at)}</span>
                </div>
              </section>

              <section className="drawer-section">
                <h3 className="drawer-section-title">Retry predictions</h3>
                {(!detail.retry_predictions || detail.retry_predictions.length === 0) ? (
                  <p className="text-faint">No predictions yet — run one from Retry Intelligence.</p>
                ) : (
                  <div className="drawer-predictions">
                    {detail.retry_predictions.map((pred) => (
                      <div className="drawer-prediction" key={pred.id}>
                        <div className="drawer-prediction-top">
                          <span className="badge badge-success">
                            <span className="badge-dot" />
                            {RETRY_WINDOW_LABELS[pred.recommended_window] || humanize(pred.recommended_window)}
                          </span>
                          <span className="text-faint">{formatDateTime(pred.created_at)}</span>
                        </div>
                        <div className="drawer-prediction-grid">
                          {PREDICTION_WINDOW_COLUMNS.map((col) => (
                            <div key={col.key}>
                              <span className="text-faint">{col.label}</span>
                              <strong>{formatPercent(pred[col.key])}</strong>
                            </div>
                          ))}
                        </div>
                        <div className="drawer-kv">
                          <span>Expected recovery value</span>
                          <span>{formatCurrency(pred.expected_recovery_value, detail.currency)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="drawer-section">
                <h3 className="drawer-section-title">Event history</h3>
                {(!detail.events || detail.events.length === 0) ? (
                  <p className="text-faint">No events recorded yet.</p>
                ) : (
                  <Timeline
                    items={detail.events.map((e) => ({
                      id: e.id,
                      label: EVENT_TYPE_META[e.event_type]?.label || humanize(e.event_type),
                      detail: describeEvent(e),
                      timestamp: e.created_at,
                      type: EVENT_TYPE_META[e.event_type]?.type || 'info',
                    }))}
                    dense
                  />
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
