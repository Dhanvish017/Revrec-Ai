import { STATUS_LABELS } from '../utils/format'

const STATUS_TONE = {
  recovered: 'success',
  retrying: 'info',
  awaiting_customer: 'warning',
  failed: 'danger',
  escalated: 'neutral',
}

export default function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] ?? 'neutral'
  const label = STATUS_LABELS[status] ?? status

  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {label}
    </span>
  )
}
