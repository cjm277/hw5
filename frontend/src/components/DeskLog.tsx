import { useEffect, useRef } from 'react'
import type { DeskEvent } from '../api.ts'
import { agentName, INTERNAL_TOOLS, isAgent, logLine } from '../floor.ts'

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/** When it happened: a human decision's own decided_at when known, otherwise when it was logged. */
const when = (e: DeskEvent) => {
  const decided = typeof e.detail.decided_at === 'string' ? e.detail.decided_at : ''
  return decided && !Number.isNaN(Date.parse(decided)) ? decided : e.time
}

/** A running conversation of the team: who said what, who handed what to whom, which tools they touched. */
export default function DeskLog({ events, running }: { events: DeskEvent[]; running: boolean }) {
  const box = useRef<HTMLOListElement>(null)
  const lines = events.map((e) => ({ e, line: logLine(e) })).filter((x) => x.line !== null)

  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  return (
    <section className="panel log-panel" aria-labelledby="log-h">
      <div className="panel-head">
        <span className="eyebrow">What the team is saying</span>
        <h2 id="log-h">
          Desk log {running && <span className="live-tag">Live</span>}
        </h2>
      </div>
      {lines.length === 0 ? (
        <p className="empty small muted">Pick a ticket and send it to the team. Every step they take shows up here.</p>
      ) : (
        <ol className="log" ref={box}>
          {lines.map(({ e, line }) => (
            <li key={e.seq} className={`log-row log-${line!.kind} who-${isAgent(e.agent) || e.agent === 'human' ? e.agent : 'team'}`}>
              <span className="log-avatar" aria-hidden="true">
                {isAgent(e.agent) ? agentName(e.agent).slice(0, 1) : e.agent === 'human' ? '✍' : '★'}
              </span>
              <div className="log-body">
                <div className="log-meta">
                  <strong>{agentName(e.agent)}</strong>
                  {line!.kind === 'handoff' && <span className="handoff-arrow">→ {agentName(String(e.detail.to_agent))}</span>}
                  <time>
                    {time(when(e))}
                    {e.detail.backfilled || e.detail.applied_after_run ? ' · logged later' : ''}
                  </time>
                </div>
                <p>{line!.text}</p>
                {e.event === 'model_step' && e.tools.some((t) => !INTERNAL_TOOLS.has(t)) && (
                  <div className="log-tools">
                    {e.tools.filter((t) => !INTERNAL_TOOLS.has(t)).map((t, i) => (
                      <code key={i} className="tool-chip">
                        {t}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
