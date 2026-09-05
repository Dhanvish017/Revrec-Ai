import { useState } from 'react'
import { AlertCircle, CheckCircle2, FlaskConical, Loader2 } from 'lucide-react'
import { api, ApiError } from '../services/api'
import { launchRazorpayCheckout, RazorpayError } from '../services/razorpay'
import { formatCurrency, formatDateTime, humanize } from '../utils/format'
import './TestPaymentLab.css'

const PAYMENT_METHODS = ['card', 'upi', 'netbanking', 'wallet', 'emi']
const CURRENCIES = ['INR', 'USD']
const FAILURE_REASONS = [
  'insufficient_funds',
  'network_error',
  'processing_error',
  'bank_decline',
  'expired_card',
  'incorrect_details',
  'fraud_suspected',
]
const CUSTOMER_PATTERNS = ['reliable', 'occasional_failure', 'high_risk', 'chronic_failure']

const initialForm = {
  amount: '1500',
  currency: 'INR',
  paymentMethod: PAYMENT_METHODS[0],
  failureReason: FAILURE_REASONS[0],
  customerName: 'Test Customer',
  customerEmail: 'test.customer@example.com',
  customerPattern: CUSTOMER_PATTERNS[1],
  previousAttempts: '0',
}

export default function TestPaymentLab() {
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [rzpStatus, setRzpStatus] = useState(null)

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setRzpStatus(null)

    let settled = false
    try {
      setRzpStatus({ type: 'info', message: 'Opening Razorpay Test Checkout…' })
      await launchRazorpayCheckout({
        amount: Number(form.amount),
        currency: form.currency,
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        onSuccess: (response) => {
          settled = true
          setRzpStatus({
            type: 'success',
            message: `Razorpay Test Mode payment captured — ${response.razorpay_payment_id}`,
          })
        },
        onFailure: (razorpayErr) => {
          settled = true
          setRzpStatus({
            type: 'error',
            message: razorpayErr?.description || 'The Razorpay test payment failed.',
          })
        },
        onDismiss: () => {
          if (!settled) {
            setRzpStatus({ type: 'error', message: 'Checkout closed before completing the payment.' })
          }
        },
      })
    } catch (err) {
      setRzpStatus({
        type: 'error',
        message: err instanceof RazorpayError ? err.message : 'Could not start Razorpay Test Checkout.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Retained for internal testing only — writes a simulated failed payment
  // straight to Supabase via the RevRec AI backend. Intentionally not called
  // by the Razorpay Test Checkout button above, which must only create a
  // real Razorpay Test Mode order and never a fake failed payment.
  const createSimulatedFailedPaymentForTesting = async () => {
    try {
      const payment = await api.createTestPayment({
        amount: Number(form.amount),
        currency: form.currency,
        paymentMethod: form.paymentMethod,
        failureReason: form.failureReason,
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        customerPattern: form.customerPattern,
        previousAttempts: Number(form.previousAttempts) || 0,
      })
      setHistory((h) => [payment, ...h])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong creating the payment.')
    }
  }

  return (
    <div className="page">
      <div className="test-lab-grid">
        <div className="card">
          <div className="card-header">
            <h2>Create test payment</h2>
            <span className="badge badge-info"><FlaskConical size={12} />Razorpay Test Mode</span>
          </div>
          <form className="test-lab-form" onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="amount">Amount</label>
                <input
                  id="amount"
                  className="input"
                  type="number"
                  min="1"
                  step="1"
                  value={form.amount}
                  onChange={update('amount')}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="currency">Currency</label>
                <select id="currency" className="select" value={form.currency} onChange={update('currency')}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label htmlFor="paymentMethod">Payment method</label>
                <select id="paymentMethod" className="select" value={form.paymentMethod} onChange={update('paymentMethod')}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{humanize(m)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="failureReason">Failure reason</label>
                <select id="failureReason" className="select" value={form.failureReason} onChange={update('failureReason')}>
                  {FAILURE_REASONS.map((r) => (
                    <option key={r} value={r}>{humanize(r)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label htmlFor="customerPattern">Customer payment pattern</label>
                <select id="customerPattern" className="select" value={form.customerPattern} onChange={update('customerPattern')}>
                  {CUSTOMER_PATTERNS.map((p) => (
                    <option key={p} value={p}>{humanize(p)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="previousAttempts">Previous failed attempts</label>
                <input
                  id="previousAttempts"
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={form.previousAttempts}
                  onChange={update('previousAttempts')}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label htmlFor="customerName">Customer name</label>
                <input
                  id="customerName"
                  className="input"
                  type="text"
                  value={form.customerName}
                  onChange={update('customerName')}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="customerEmail">Customer email</label>
                <input
                  id="customerEmail"
                  className="input"
                  type="email"
                  value={form.customerEmail}
                  onChange={update('customerEmail')}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <Loader2 size={15} className="spin" /> : <FlaskConical size={15} />}
              {submitting ? 'Creating payment…' : 'Create test payment'}
            </button>

            {error && (
              <div className="test-lab-error">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            {rzpStatus && (
              <div className={`test-lab-rzp-status test-lab-rzp-status-${rzpStatus.type}`}>
                {rzpStatus.type === 'success' && <CheckCircle2 size={15} />}
                {rzpStatus.type === 'error' && <AlertCircle size={15} />}
                {rzpStatus.type === 'info' && <Loader2 size={15} className="spin" />}
                <span>{rzpStatus.message}</span>
              </div>
            )}

            <p className="test-lab-note">
              This calls <code>POST /api/razorpay/create-order</code> and opens a real Razorpay{' '}
              <strong>Test Mode</strong> checkout for the entered amount — no simulated payment is written to
              Supabase.
            </p>
          </form>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Results</h2>
          </div>
          <div className="test-lab-history scrollbar-thin">
            {history.length === 0 && (
              <div className="test-lab-empty">
                <FlaskConical size={22} />
                <p>Submit the form to create a test payment. The backend's response will appear here.</p>
              </div>
            )}
            {history.map((p) => (
              <div className="test-result-item" key={p.id}>
                <div className="test-result-top">
                  <span className="mono">{p.payment_id}</span>
                  <span className={`badge ${p.status === 'recovered' ? 'badge-success' : 'badge-danger'}`}>
                    <span className="badge-dot" />
                    {humanize(p.status)}
                  </span>
                </div>
                <div className="test-result-body">
                  <div>
                    <span className="text-faint">Amount</span>
                    <strong>{formatCurrency(p.amount, p.currency)}</strong>
                  </div>
                  <div>
                    <span className="text-faint">Method</span>
                    <strong>{humanize(p.payment_method)}</strong>
                  </div>
                  <div>
                    <span className="text-faint">Customer</span>
                    <strong>{p.customer_name}</strong>
                  </div>
                  <div>
                    <span className="text-faint">Risk score</span>
                    <strong>{p.risk_score} / 100</strong>
                  </div>
                  <div>
                    <span className="text-faint">Created</span>
                    <strong>{formatDateTime(p.created_at)}</strong>
                  </div>
                  <div>
                    <span className="text-faint">Attempts</span>
                    <strong>{p.previous_attempts}</strong>
                  </div>
                </div>
                <p className="test-result-reason">Failure reason: {humanize(p.failure_reason)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
