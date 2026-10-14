import type { BoardRun, Floor } from '../floor.ts'
import { AGENTS } from '../floor.ts'
import AgentFigure from './AgentFigure.tsx'

const clip = (s: string, n = 320) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** After a run: the boss's call, then one short card per agent saying what they did. */
export default function RunSummary({ floor, run, waiting }: { floor: Floor; run: BoardRun; waiting: number }) {
  const o = floor.outcome
  const worked = AGENTS.map((a) => floor.agents[a.id]).filter((s) => s.tasks.length > 0)

  return (
    <section className="panel summary-panel" aria-labelledby="summary-h">
      <div className="panel-head summary-head">
        <div>
          <span className="eyebrow">Ticket #{run.ticket_id} · run {run.run_id}</span>
          <h2 id="summary-h">What the team did</h2>
        </div>
        {run.status === 'finished' && waiting === 0 && (
          <span className="resolved-stamp" aria-label="Resolved">
            ✓ Resolved
          </span>
        )}
        {run.status === 'finished' && waiting > 0 && (
          <span className="waiting-stamp" aria-label="Team done, waiting on human">
            Waiting on you
          </span>
        )}
        {run.status === 'failed' && <span className="failed-stamp">Run failed</span>}
      </div>

      {run.status === 'finished' && waiting > 0 && (
        <p className="waiting-note">
          The team is done. {waiting === 1 ? '1 request needs' : `${waiting} requests need`} your signature in “Needs your signature” at the top
          right of the floor. This ticket turns green once you approve or reject {waiting === 1 ? 'it' : 'them'}.
        </p>
      )}

      {run.status === 'failed' && <p className="approval-error">{run.error ?? floor.error ?? 'The run stopped with an error.'}</p>}

      {o && (
        <div className="boss-call">
          <p className="boss-decision">
            <strong>The Boss's call:</strong> {o.decision}
          </p>
          <p>
            <strong>For you:</strong> {o.summary_for_human}
          </p>
          <div className="outcome-chips">
            <span className="chip">Final status: {o.final_status.replace(/_/g, ' ')}</span>
            {floor.stats && <span className="chip">{floor.stats.delegations} hand-offs</span>}
            {floor.stats && <span className="chip">{floor.stats.modelSteps} model steps</span>}
          </div>
          {o.blocked_by.length > 0 && (
            <ul className="blocked">
              {o.blocked_by.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {o.guardrail_notes.length > 0 && (
            <p className="small muted">Guardrails: {o.guardrail_notes.join(' · ')}</p>
          )}
        </div>
      )}

      <ul className="agent-summaries">
        {worked.map((s) => {
          const meta = AGENTS.find((a) => a.id === s.id)!
          const tools = Object.entries(s.tools)
          return (
            <li key={s.id} className={`agent-summary summary-${s.id}`}>
              <div className="mini-figure">
                <AgentFigure agent={s.id} mood="idle" />
              </div>
              <div>
                <h3>
                  {meta.name}
                  <span className="small muted"> · {s.tasks.length === 1 ? '1 task' : `${s.tasks.length} tasks`}</span>
                </h3>
                <p>{s.answers.length ? clip(s.answers[s.answers.length - 1]) : s.line ?? 'No answer recorded.'}</p>
                {s.actions.length > 0 && (
                  <ul className="actions">
                    {s.actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
                {tools.length > 0 && (
                  <div className="log-tools">
                    {tools.map(([t, n]) => (
                      <code key={t} className="tool-chip">
                        {t}
                        {n > 1 ? ` ×${n}` : ''}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {floor.agents.customer_service.drafts.map((d, i) => (
        <figure className="letter" key={i}>
          <figcaption>
            <span className="eyebrow">Draft reply · waiting on the board, not sent</span>
            <strong>To {d.recipient}</strong> · {d.subject}
          </figcaption>
          <p>{d.body}</p>
        </figure>
      ))}
    </section>
  )
}
