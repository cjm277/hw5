import type { AgentState } from '../floor.ts'
import { AGENTS, agentName } from '../floor.ts'
import AgentFigure from './AgentFigure.tsx'

const STATUS_LABEL = { idle: 'At desk', working: 'Working', done: 'Done', error: 'Stopped' } as const

/** One agent's desk: the figure, a speech bubble with what they're saying, and their latest tool. */
export default function AgentStation({ state, running }: { state: AgentState; running: boolean }) {
  const meta = AGENTS.find((a) => a.id === state.id)!
  const askedBy = state.askedBy.filter((a) => a !== 'desk')
  const quiet = !state.line
  const bubble = state.line ?? (running ? 'Standing by in case someone hands me work.' : 'Waiting for a ticket.')

  return (
    <article className={`station station-${state.id} is-${state.status}`} aria-label={`${meta.name} desk`}>
      <div className={`bubble ${quiet ? 'bubble-quiet' : ''}`} title={state.line ?? undefined}>
        {state.status === 'working' && !state.line ? (
          <span className="dots" aria-label="thinking">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <p>{bubble}</p>
        )}
      </div>

      <div className="station-figure">
        <AgentFigure agent={state.id} mood={state.status} />
        <span className={`status-light light-${state.status}`} title={STATUS_LABEL[state.status]} />
        {state.status === 'done' && (
          <span className="done-badge" aria-hidden="true">
            ✓
          </span>
        )}
      </div>

      <div className="desk-front">
        <div className="nameplate">
          <strong>{meta.name}</strong>
          <span>{STATUS_LABEL[state.status]}{state.active > 1 ? ` ×${state.active}` : ''}</span>
        </div>
      </div>

      <div className="station-meta">
        {state.tool ? <code className="tool-chip is-live">{state.tool}</code> : <span className="station-role">{meta.role}</span>}
        {askedBy.length > 0 && <span className="asked-by">Asked by {askedBy.map(agentName).join(', ')}</span>}
      </div>
    </article>
  )
}
