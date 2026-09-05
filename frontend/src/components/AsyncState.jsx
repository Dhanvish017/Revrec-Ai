import { AlertCircle, Inbox, Loader2 } from 'lucide-react'
import './AsyncState.css'

// Shared loading / error / empty presentation so every page that talks to
// the backend handles these three states the same way.
export default function AsyncState({
  loading,
  error,
  empty,
  onRetry,
  loadingText = 'Loading…',
  emptyText = 'Nothing to show yet.',
  compact = false,
}) {
  if (loading) {
    return (
      <div className={`async-state${compact ? ' compact' : ''}`}>
        <Loader2 size={18} className="spin" />
        <p>{loadingText}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`async-state error${compact ? ' compact' : ''}`}>
        <AlertCircle size={18} />
        <p>{error}</p>
        {onRetry && (
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    )
  }

  if (empty) {
    return (
      <div className={`async-state${compact ? ' compact' : ''}`}>
        <Inbox size={18} />
        <p>{emptyText}</p>
      </div>
    )
  }

  return null
}
