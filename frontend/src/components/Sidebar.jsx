import { NavLink } from 'react-router-dom'
import { LayoutDashboard, AlertTriangle, Bot, FlaskConical, ShieldCheck, Sparkles } from 'lucide-react'
import './Sidebar.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/failures', label: 'Payment Failures', icon: AlertTriangle },
  { to: '/retry-intelligence', label: 'Retry Intelligence', icon: Sparkles },
  { to: '/agent', label: 'AI Agent', icon: Bot },
  { to: '/test-lab', label: 'Test Payment Lab', icon: FlaskConical },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          <ShieldCheck size={18} strokeWidth={2.25} />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">RevRec AI</span>
          <span className="sidebar-brand-subtitle">Revenue Recovery</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <Icon size={17} strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <p className="sidebar-footer-hint">Razorpay Buildathon build</p>
      </div>
    </aside>
  )
}
