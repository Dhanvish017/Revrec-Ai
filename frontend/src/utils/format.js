export function formatCurrency(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0)
}

export function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - new Date(timestamp).getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}d ago`
}

export function formatPercent(fraction, digits = 0) {
  if (fraction === null || fraction === undefined || Number.isNaN(Number(fraction))) return '—'
  return `${(Number(fraction) * 100).toFixed(digits)}%`
}

// Turns backend enum-style strings ("insufficient_funds", "ML_PREDICTION_CREATED")
// into readable text ("Insufficient funds", "Ml prediction created").
export function humanize(value) {
  if (!value) return '—'
  const words = String(value).toLowerCase().replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const STATUS_LABELS = {
  recovered: 'Recovered',
  failed: 'Failed',
  retrying: 'Retrying',
  awaiting_customer: 'Awaiting customer',
  escalated: 'Escalated',
}

// Matches the RETRY_WINDOWS labels in revrec-backend/services/retryEngine.js
export const RETRY_WINDOW_LABELS = {
  retry_now: 'Retry Now',
  retry_15min: 'Retry in 15 Minutes',
  retry_1hr: 'Retry in 1 Hour',
  retry_6hr: 'Retry in 6 Hours',
  retry_tomorrow: 'Retry Tomorrow',
}

export const RETRY_WINDOW_ORDER = ['retry_now', 'retry_15min', 'retry_1hr', 'retry_6hr', 'retry_tomorrow']

// event_type -> Timeline visual treatment, for rendering payment_events rows.
export const EVENT_TYPE_META = {
  PAYMENT_FAILED: { label: 'Payment failed', type: 'warning' },
  ML_PREDICTION_CREATED: { label: 'ML prediction generated', type: 'info' },
  RETRY_EXECUTED: { label: 'Retry executed', type: 'agent' },
  PAYMENT_RECOVERED: { label: 'Payment recovered', type: 'success' },
  RETRY_ATTEMPT_FAILED: { label: 'Retry attempt failed', type: 'warning' },
  RECOVERY_MESSAGE_SENT: { label: 'Recovery message sent (Test Mode)', type: 'agent' },
}
