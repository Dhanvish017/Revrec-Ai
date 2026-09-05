import { AlertTriangle, Bot, CheckCircle2, Info, Server } from 'lucide-react'
import { formatDateTime, formatRelativeTime } from '../utils/format'
import './Timeline.css'

const TYPE_ICON = {
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
  system: Server,
  agent: Bot,
}

const TYPE_TONE = {
  success: 'success',
  warning: 'warning',
  info: 'info',
  system: 'neutral',
  agent: 'brand',
}

export default function Timeline({ items, dense = false }) {
  return (
    <ol className={`timeline${dense ? ' dense' : ''}`}>
      {items.map((item, i) => {
        const type = item.type ?? item.actor ?? 'info'
        const Icon = TYPE_ICON[type] ?? Info
        const tone = TYPE_TONE[type] ?? 'neutral'
        return (
          <li key={item.id ?? i} className="timeline-item">
            <span className={`timeline-icon tone-${tone}`}>
              <Icon size={13} strokeWidth={2.25} />
            </span>
            <div className="timeline-content">
              <div className="timeline-row">
                <span className="timeline-label">{item.label ?? item.title}</span>
                <span className="timeline-time" title={formatDateTime(item.timestamp)}>
                  {formatRelativeTime(item.timestamp)}
                </span>
              </div>
              {item.detail && <p className="timeline-detail">{item.detail}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
