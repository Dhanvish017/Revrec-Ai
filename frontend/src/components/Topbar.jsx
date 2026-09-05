import { useLocation } from 'react-router-dom'
import { Bell, Search } from 'lucide-react'
import './Topbar.css'

const TITLES = {
  '/': { title: 'Dashboard', subtitle: "Overview of your revenue recovery performance" },
  '/failures': { title: 'Payment Failures', subtitle: 'Search and investigate failed payments' },
  '/retry-intelligence': { title: 'Retry Intelligence', subtitle: 'ML-powered adaptive retry timing engine' },
  '/test-lab': { title: 'Test Payment Lab', subtitle: 'Create simulated Razorpay test payments' },
}

export default function Topbar() {
  const { pathname } = useLocation()
  const meta = TITLES[pathname] ?? TITLES['/']

  return (
    <header className="topbar">
      <div>
        <h1 className="topbar-title">{meta.title}</h1>
        <p className="topbar-subtitle">{meta.subtitle}</p>
      </div>

      <div className="topbar-actions">
        <div className="topbar-search">
          <Search size={15} />
          <input type="text" placeholder="Search payments, customers…" />
        </div>
        <button className="topbar-icon-btn" type="button" aria-label="Notifications">
          <Bell size={17} />
        </button>
        <div className="topbar-avatar">DS</div>
      </div>
    </header>
  )
}
