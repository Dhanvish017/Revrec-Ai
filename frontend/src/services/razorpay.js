// Razorpay Test Mode Checkout integration.
// Talks to the standalone Razorpay backend (separate from the RevRec AI
// backend in services/api.js) which holds the Razorpay secret key and
// creates orders server-side. The frontend only ever sees the public
// key_id and order_id — never a secret.

const RAZORPAY_BACKEND_URL = 'https://razorpay-backend-anrp.onrender.com'
const CHECKOUT_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

let checkoutScriptPromise = null

function loadCheckoutScript() {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)
  if (checkoutScriptPromise) return checkoutScriptPromise

  checkoutScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(true))
      existing.addEventListener('error', () => resolve(false))
      return
    }

    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => {
      checkoutScriptPromise = null
      resolve(false)
    }
    document.body.appendChild(script)
  })

  return checkoutScriptPromise
}

export class RazorpayError extends Error {}

async function createOrder({ amount, currency }) {
  let response
  try {
    response = await fetch(`${RAZORPAY_BACKEND_URL}/api/razorpay/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency }),
    })
  } catch {
    throw new RazorpayError(`Could not reach the Razorpay backend at ${RAZORPAY_BACKEND_URL}.`)
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // no JSON body
  }

  if (!response.ok) {
    throw new RazorpayError(body?.error || body?.message || `Order creation failed with status ${response.status}`)
  }

  const data = body?.data ?? body ?? {}
  const orderId = data.order_id ?? data.id
  const keyId = data.key_id
  if (!orderId || !keyId) {
    throw new RazorpayError('Razorpay backend response did not include an order_id and key_id.')
  }

  return {
    orderId,
    amount: data.amount ?? amount,
    currency: data.currency ?? currency,
    keyId,
  }
}

// Creates a real Razorpay order in Test Mode and opens Checkout for it.
// `amount` is in the major currency unit (e.g. rupees), matching the
// Test Payment Lab form — the backend is responsible for converting to
// the smallest unit when it creates the order.
export async function launchRazorpayCheckout({
  amount,
  currency,
  customerName,
  customerEmail,
  onSuccess,
  onFailure,
  onDismiss,
}) {
  const order = await createOrder({ amount, currency })

  const scriptLoaded = await loadCheckoutScript()
  if (!scriptLoaded || !window.Razorpay) {
    throw new RazorpayError('Razorpay Checkout script failed to load.')
  }

  const options = {
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    order_id: order.orderId,
    name: 'RevRec AI',
    description: 'Test Payment Lab (Razorpay Test Mode)',
    prefill: {
      name: customerName,
      email: customerEmail,
    },
    notes: {
      source: 'revrec-ai-test-payment-lab',
    },
    theme: { color: '#2f6fed' },
    handler: (response) => onSuccess?.(response),
    modal: {
      ondismiss: () => onDismiss?.(),
    },
  }

  const checkout = new window.Razorpay(options)
  checkout.on('payment.failed', (response) => onFailure?.(response.error))
  checkout.open()
}
