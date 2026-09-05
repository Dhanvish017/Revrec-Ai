import { useState } from 'react'
import { AlertCircle, CheckCircle2, FlaskConical, Loader2 } from 'lucide-react'
import { launchRazorpayCheckout, RazorpayError } from '../services/razorpay'
import './TestPaymentLab.css'

const CURRENCIES = ['INR', 'USD']

const initialForm = {
  amount: '',
  currency: 'INR',
}

function isFormValid(form) {
  return form.amount !== '' && Number(form.amount) > 0 && form.currency !== ''
}

export default function TestPaymentLab() {
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [rzpStatus, setRzpStatus] = useState(null)

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isFormValid(form)) return

    setSubmitting(true)
    setRzpStatus(null)

    let settled = false
    try {
      setRzpStatus({ type: 'info', message: 'Opening Razorpay Test Checkout…' })
      await launchRazorpayCheckout({
        amount: Number(form.amount),
        currency: form.currency,
        onSuccess: (response) => {
          settled = true
          setRzpStatus({
            type: 'success',
            message: `Razorpay Test Mode payment captured — ${response.razorpay_payment_id}`,
          })
          setForm(initialForm)
        },
        onFailure: (razorpayErr) => {
          settled = true
          setRzpStatus({
            type: 'error',
            message:
              (razorpayErr?.description || 'The Razorpay test payment failed.') +
              ' It will appear on the Payment Failures page once the webhook is processed.',
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

  return (
    <div className="page">
      <div className="card test-lab-card">
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
              <select id="currency" className="select" value={form.currency} onChange={update('currency')} required>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={submitting || !isFormValid(form)}>
            {submitting ? <Loader2 size={15} className="spin" /> : <FlaskConical size={15} />}
            {submitting ? 'Opening checkout…' : 'Pay with Razorpay Test Checkout'}
          </button>

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
            <strong>Test Mode</strong> checkout for the entered amount. Use any Razorpay test card, UPI ID, or
            netbanking option to complete or deliberately fail the payment — success or failure is decided by
            Razorpay itself, not by this form. A failed payment is recorded automatically via the{' '}
            <code>payment.failed</code> webhook and shows up on the Payment Failures page.
          </p>
        </form>
      </div>
    </div>
  )
}
