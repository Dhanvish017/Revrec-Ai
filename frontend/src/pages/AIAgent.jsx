import AsyncState from '../components/AsyncState'

// The backend does not yet expose an AI agent status/decisions/guardrails
// endpoint (no /api/agent/* route exists). Rather than invent agent activity,
// this page honestly shows that there is nothing to display yet.
export default function AIAgent() {
  return (
    <div className="page">
      <div className="card">
        <AsyncState
          empty
          emptyText="No agent data available. The backend doesn't expose an AI agent status/decisions endpoint yet, so there is nothing real to show here."
        />
      </div>
    </div>
  )
}
