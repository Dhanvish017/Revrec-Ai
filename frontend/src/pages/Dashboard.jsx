import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, TrendingUp, Wallet } from 'lucide-react'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import Timeline from '../components/Timeline'
import AsyncState from '../components/AsyncState'
import { api, ApiError } from '../services/api'
import { formatCurrency, formatRelativeTime, humanize } from '../utils/format'
import './Dashboard.css'

function buildRecoveryTrend(payments) {
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return { key: d.toDateString(), label: d.toLocaleDateString('en-IN', { weekday: 'short' }), recovered: 0, atRisk: 0 }
  })

  for (const p of payments) {
    const bucket = days.find((d) => d.key === new Date(p.created_at).toDateString())
    if (!bucket) continue
    if (p.status === 'recovered') bucket.recovered += Number(p.amount) || 0
    else bucket.atRisk += Number(p.amount) || 0
  }

  return days
}

function buildActivityFeed(payments) {
  return [...payments]
    .map((p) => {
      if (p.status === 'recovered') {
        return {
          id: `${p.id}-recovered`,
          label: `Payment recovered — ${p.payment_id || p.id}`,
          detail: `${p.customer_name} · ${formatCurrency(p.amount, p.currency)} recovered after ${p.previous_attempts} attempt(s)`,
          timestamp: p.updated_at,
          type: 'success',
        }
      }
      if (p.previous_attempts > 0) {
        return {
          id: `${p.id}-retry`,
          label: `Retry attempt failed — ${p.payment_id || p.id}`,
          detail: `${p.customer_name} · ${p.previous_attempts} attempt(s) so far · ${humanize(p.failure_reason)}`,
          timestamp: p.updated_at,
          type: 'warning',
        }
      }
      return {
        id: `${p.id}-failed`,
        label: `Payment failed — ${p.payment_id || p.id}`,
        detail: `${p.customer_name} · ${humanize(p.failure_reason)}`,
        timestamp: p.created_at,
        type: 'warning',
      }
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 6)
}

export default function Dashboard() {
  const navigate = useNavigate()

  const [metrics, setMetrics] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([api.getDashboard(), api.getPayments()])
      .then(([dashboardData, paymentsData]) => {
        setMetrics(dashboardData)
        setPayments(paymentsData || [])
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard data.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const recoveryTrend = useMemo(() => buildRecoveryTrend(payments), [payments])
  const activityFeed = useMemo(() => buildActivityFeed(payments), [payments])
  const recentFailures = useMemo(
    () => [...payments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6),
    [payments]
  )
  const maxTrendValue = Math.max(1, ...recoveryTrend.flatMap((d) => [d.recovered, d.atRisk]))
  const hasPayments = payments.length > 0

  if (loading || error || !metrics) {
    return (
      <div className="page">
        <div className="card">
          <AsyncState
            loading={loading}
            error={error}
            onRetry={load}
            loadingText="Loading dashboard metrics from the backend…"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="grid-stats">
        <StatCard
          label="Revenue at risk"
          value={formatCurrency(metrics.revenueAtRisk)}
          icon={AlertTriangle}
          tone="danger"
        />
        <StatCard
          label="Recovered revenue"
          value={formatCurrency(metrics.recoveredRevenue)}
          icon={Wallet}
          tone="success"
        />
        <StatCard
          label="Recovery rate"
          value={`${metrics.recoveryRate}%`}
          icon={TrendingUp}
          tone="brand"
        />
        <StatCard
          label="Active cases"
          value={metrics.activeRecoveryCases}
          icon={CheckCircle2}
          tone="warning"
        />
      </div>

      <div className="dashboard-grid">
        <div className="card trend-card">
          <div className="card-header">
            <h2>Recovery trend (7 days)</h2>
            <div className="trend-legend">
              <span className="legend-item"><i className="legend-dot recovered" />Recovered</span>
              <span className="legend-item"><i className="legend-dot at-risk" />At risk</span>
            </div>
          </div>
          <div className="card-body">
            {!hasPayments ? (
              <AsyncState compact empty emptyText="No payments yet — create one in the Test Payment Lab." />
            ) : (
              <div className="trend-chart">
                {recoveryTrend.map((d) => (
                  <div className="trend-col" key={d.key}>
                    <div className="trend-bars">
                      <div
                        className="trend-bar recovered"
                        style={{ height: `${(d.recovered / maxTrendValue) * 100}%` }}
                        title={formatCurrency(d.recovered)}
                      />
                      <div
                        className="trend-bar at-risk"
                        style={{ height: `${(d.atRisk / maxTrendValue) * 100}%` }}
                        title={formatCurrency(d.atRisk)}
                      />
                    </div>
                    <span className="trend-day">{d.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card activity-card">
          <div className="card-header">
            <h2>Recent activity</h2>
          </div>
          <div className="card-body">
            {!hasPayments ? (
              <AsyncState compact empty emptyText="No activity yet." />
            ) : (
              <Timeline items={activityFeed} dense />
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Recent failures</h2>
          <button type="button" className="btn btn-sm" onClick={() => navigate('/failures')}>
            View all
          </button>
        </div>
        {!hasPayments ? (
          <AsyncState empty emptyText="No payments yet — create one in the Test Payment Lab to see it here." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {recentFailures.map((p) => (
                  <tr key={p.id} className="clickable-row" onClick={() => navigate(`/failures?payment=${p.id}`)}>
                    <td className="mono">{p.payment_id || p.id}</td>
                    <td>{p.customer_name}</td>
                    <td>{formatCurrency(p.amount, p.currency)}</td>
                    <td>{humanize(p.failure_reason)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-muted">{formatRelativeTime(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
