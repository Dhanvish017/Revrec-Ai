import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import './StatCard.css'

export default function StatCard({ label, value, deltaLabel, deltaGood, icon: Icon, tone = 'neutral' }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {Icon && (
          <span className={`stat-card-icon tone-${tone}`}>
            <Icon size={16} strokeWidth={2} />
          </span>
        )}
      </div>
      <div className="stat-card-value">{value}</div>
      {deltaLabel && (
        <div className={`stat-card-delta ${deltaGood ? 'good' : 'bad'}`}>
          {deltaGood ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          <span>{deltaLabel}</span>
        </div>
      )}
    </div>
  )
}
