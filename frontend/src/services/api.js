// Thin fetch wrapper around the RevRec AI backend (Node/Express + Supabase).
// The frontend never talks to Supabase directly — every read/write goes
// through these endpoints, matching the routes in revrec-backend/routes/*.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    })
  } catch {
    throw new ApiError(`Could not reach the RevRec AI backend at ${API_URL}. Is it running?`, 0)
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // No JSON body (e.g. a 204, or the server crashed before responding).
  }

  if (!body) {
    if (!response.ok) throw new ApiError(`Request failed with status ${response.status}`, response.status)
    return undefined
  }

  // The backend sometimes returns a non-2xx status with `success: true` for
  // an expected business outcome (e.g. 422 when a retry is guardrail-blocked)
  // — that's not a request failure, so only `success: false` throws.
  if (body.success === false) {
    throw new ApiError(body.error || `Request failed with status ${response.status}`, response.status)
  }

  return body.data
}

export const api = {
  getDashboard: () => request('/api/dashboard'),

  getPayments: () => request('/api/payments'),
  getPayment: (id) => request(`/api/payments/${id}`),
  createTestPayment: (payload) =>
    request('/api/payments/create-test', { method: 'POST', body: JSON.stringify(payload) }),

  predictRetry: (paymentId) => request(`/api/retry/predict/${paymentId}`, { method: 'POST' }),
  validateRetry: (paymentId) => request(`/api/retry/validate/${paymentId}`, { method: 'POST' }),
  executeRetry: (paymentId) => request(`/api/retry/execute/${paymentId}`, { method: 'POST' }),
}
