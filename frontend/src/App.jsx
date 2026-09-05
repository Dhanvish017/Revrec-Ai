import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import Dashboard from './pages/Dashboard'
import PaymentFailures from './pages/PaymentFailures'
import TestPaymentLab from './pages/TestPaymentLab'
import RetryIntelligence from './pages/RetryIntelligence'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/failures" element={<PaymentFailures />} />
        <Route path="/retry-intelligence" element={<RetryIntelligence />} />
        <Route path="/test-lab" element={<TestPaymentLab />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
