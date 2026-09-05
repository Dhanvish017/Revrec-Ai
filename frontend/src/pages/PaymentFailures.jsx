import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import PaymentDetailDrawer from '../components/PaymentDetailDrawer'
import AsyncState from '../components/AsyncState'
import { api, ApiError } from '../services/api'
import { formatCurrency, formatDateTime, humanize, STATUS_LABELS } from '../utils/format'
import './PaymentFailures.css'

const PAGE_SIZE = 10

export default function PaymentFailures() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [page, setPage] = useState(1)

  const [payments, setPayments] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(null)

  const selectedId = searchParams.get('payment')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)

  const loadPayments = () => {
    setListLoading(true)
    setListError(null)
    api
      .getPayments()
      .then((data) => setPayments(data || []))
      .catch((err) => setListError(err instanceof ApiError ? err.message : 'Failed to load payments.'))
      .finally(() => setListLoading(false))
  }

  useEffect(loadPayments, [])

  const loadDetail = (id) => {
    setDetailLoading(true)
    setDetailError(null)
    api
      .getPayment(id)
      .then((data) => setDetail(data))
      .catch((err) => setDetailError(err instanceof ApiError ? err.message : 'Failed to load payment details.'))
      .finally(() => setDetailLoading(false))
  }

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDetailError(null)
      return
    }
    loadDetail(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const statusOptions = useMemo(
    () => [...new Set(payments.map((p) => p.status))].sort(),
    [payments]
  )
  const methodOptions = useMemo(
    () => [...new Set(payments.map((p) => p.payment_method).filter(Boolean))].sort(),
    [payments]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return payments.filter((p) => {
      const matchesQuery =
        !q ||
        p.id.toLowerCase().includes(q) ||
        (p.payment_id || '').toLowerCase().includes(q) ||
        (p.customer_name || '').toLowerCase().includes(q) ||
        (p.customer_email || '').toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter
      const matchesMethod = methodFilter === 'all' || p.payment_method === methodFilter
      return matchesQuery && matchesStatus && matchesMethod
    })
  }, [payments, query, statusFilter, methodFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const openPayment = (id) => setSearchParams({ payment: id })
  const closeDrawer = () => setSearchParams({})

  const updateFilter = (setter) => (value) => {
    setter(value)
    setPage(1)
  }

  return (
    <div className="page">
      <div className="card">
        <div className="failures-toolbar">
          <div className="failures-search">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search by payment ID, customer name or email…"
              value={query}
              onChange={(e) => updateFilter(setQuery)(e.target.value)}
            />
          </div>

          <select
            className="select"
            value={statusFilter}
            onChange={(e) => updateFilter(setStatusFilter)(e.target.value)}
          >
            <option value="all">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] || humanize(s)}</option>
            ))}
          </select>

          <select
            className="select"
            value={methodFilter}
            onChange={(e) => updateFilter(setMethodFilter)(e.target.value)}
          >
            <option value="all">All methods</option>
            {methodOptions.map((m) => (
              <option key={m} value={m}>{humanize(m)}</option>
            ))}
          </select>
        </div>

        {(listLoading || listError || payments.length === 0) ? (
          <AsyncState
            loading={listLoading}
            error={listError}
            onRetry={loadPayments}
            empty={!listLoading && !listError && payments.length === 0}
            loadingText="Loading payments from the backend…"
            emptyText="No payments yet — create one in the Test Payment Lab to see it here."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Payment</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Failure reason</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Failed at</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((p) => (
                    <tr key={p.id} className="clickable-row" onClick={() => openPayment(p.id)}>
                      <td className="mono">{p.payment_id || p.id}</td>
                      <td>
                        <div className="cell-customer">
                          <span>{p.customer_name}</span>
                          <span className="text-faint">{p.customer_email}</span>
                        </div>
                      </td>
                      <td>{formatCurrency(p.amount, p.currency)}</td>
                      <td>{humanize(p.payment_method)}</td>
                      <td>{humanize(p.failure_reason)}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td>{p.previous_attempts}</td>
                      <td className="text-muted">{formatDateTime(p.created_at)}</td>
                    </tr>
                  ))}
                  {pageItems.length === 0 && (
                    <tr>
                      <td colSpan={8} className="empty-cell">No payments match your filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="failures-pagination">
              <span className="text-muted">
                Showing {pageItems.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{(page - 1) * PAGE_SIZE + pageItems.length} of {filtered.length}
              </span>
              <div className="pagination-controls">
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <span className="text-muted">Page {page} of {totalPages}</span>
                <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {selectedId && (
        <PaymentDetailDrawer
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onRetry={() => loadDetail(selectedId)}
          onClose={closeDrawer}
        />
      )}
    </div>
  )
}
