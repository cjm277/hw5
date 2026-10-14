import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type Approval, type Cash, type DeskEvent, type Health, type Ticket } from './api.ts'
import ApprovalsPanel, { type Decided } from './components/ApprovalsPanel.tsx'
import AgentStation from './components/AgentStation.tsx'
import DeskLog from './components/DeskLog.tsx'
import Logo from './components/Logo.tsx'
import RunSummary from './components/RunSummary.tsx'
import SlotBalance from './components/SlotBalance.tsx'
import TicketTray from './components/TicketTray.tsx'
import { agentName, boardState, buildFloor, money, prettyType, type BoardRun } from './floor.ts'

const RUNS_KEY = 'cc-desk-runs'
const SIGNER_KEY = 'cc-desk-signer'
const POLL_MS = 4000 // tickets, cash, approvals, health
const RUN_POLL_MS = 1000 // events + run status while the team is working

interface Toast {
  id: number
  tone: 'good' | 'bad' | 'info' | 'wait'
  text: string
}

const loadRuns = (): Record<number, BoardRun> => {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

const waitingFor = (list: Approval[] | null, ticketId: number) => (list ?? []).filter((a) => a.ticket_id === ticketId).length

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const elapsed = (from: string, to: number) => {
  const s = Math.max(0, Math.floor((to - new Date(from).getTime()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function App() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [cash, setCash] = useState<Cash | null>(null)
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const [runs, setRuns] = useState<Record<number, BoardRun>>(loadRuns)
  const [events, setEvents] = useState<Record<string, DeskEvent[]>>({})
  const [picked, setSelected] = useState<number | null>(null)
  const [signer, setSigner] = useState(() => localStorage.getItem(SIGNER_KEY) ?? '')
  const [decided, setDecided] = useState<Decided[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [starting, setStarting] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => localStorage.setItem(RUNS_KEY, JSON.stringify(runs)), [runs])
  useEffect(() => localStorage.setItem(SIGNER_KEY, signer), [signer])

  const toast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500)
  }, [])

  // --- the regular refresh: tickets, cash, approvals, health -------------------------------
  // Returns the fresh approvals (or null if the backend is unreachable).
  const refresh = useCallback(async (): Promise<Approval[] | null> => {
    try {
      const [t, c, a, h] = await Promise.all([api.tickets(), api.cash(), api.approvals(), api.health()])
      setTickets(t)
      // The Boss always closes a run by moving the ticket off "open", so a remembered finished run
      // for a ticket that is open again means the database was reset elsewhere: forget it.
      setRuns((all) => {
        const stale = t.filter((x) => x.status === 'open' && all[x.id]?.status === 'finished').map((x) => x.id)
        if (!stale.length) return all
        const next = { ...all }
        for (const id of stale) delete next[id]
        return next
      })
      setCash(c)
      setApprovals(a)
      setHealth(h)
      setOnline(true)
      return a
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOnline(false)
      return null
    }
  }, [])

  useEffect(() => {
    void refresh() // eslint-disable-line react/set-state-in-effect -- polling an external API
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  // If the server is already running a ticket (say, after a page reload), follow it.
  useEffect(() => {
    const id = health?.active_run
    if (!id || id === 'reset' || Object.values(runs).some((r) => r.run_id === id)) return
    api
      .run(id)
      .then((r) => {
        setRuns((all) => ({ ...all, [r.ticket_id]: r }))
        setSelected(r.ticket_id)
      })
      .catch(() => {})
  }, [health?.active_run, runs])

  // --- following the active run ---------------------------------------------------------------
  const activeRun = useMemo(() => Object.values(runs).find((r) => r.status === 'running'), [runs])
  const lastSeq = useRef<Record<string, number>>({})

  const pullEvents = useCallback(async (runId: string) => {
    const after = lastSeq.current[runId]
    const { events: fresh } = await api.events(runId, after)
    if (!fresh.length) return
    lastSeq.current[runId] = fresh[fresh.length - 1].seq
    setEvents((all) => {
      const known = new Set((all[runId] ?? []).map((e) => e.seq))
      return { ...all, [runId]: [...(all[runId] ?? []), ...fresh.filter((e) => !known.has(e.seq))] }
    })
  }, [])

  useEffect(() => {
    if (!activeRun) return
    const { run_id: runId, ticket_id: ticketId } = activeRun
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        await pullEvents(runId)
        const r = await api.run(runId)
        if (r.status !== 'running') {
          await pullEvents(runId)
          setRuns((all) => ({ ...all, [ticketId]: { ...all[ticketId], ...r } }))
          const fresh = await refresh()
          const waiting = waitingFor(fresh, ticketId)
          if (r.status === 'failed') toast('bad', `Ticket #${ticketId} run failed: ${r.error ?? 'unknown error'}`)
          else if (waiting > 0) toast('wait', `Team done on #${ticketId}. ${waiting} waiting for your signature, top right.`)
          else toast('good', `Ticket #${ticketId} resolved. Nothing needs a human.`)
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          // the backend restarted and forgot this run; what's in the audit trail is all we have
          setRuns((all) => ({ ...all, [ticketId]: { ...all[ticketId], status: 'failed', error: 'The backend restarted during this run.' } }))
        }
      } finally {
        busy = false
      }
    }
    void tick()
    const t = setInterval(tick, RUN_POLL_MS)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(t)
      clearInterval(clock)
    }
  }, [activeRun, pullEvents, refresh, toast])

  // --- the ticket being looked at (the first one until you pick) -------------------------------
  const selected = picked ?? tickets[0]?.id ?? null
  const ticket = tickets.find((t) => t.id === selected) ?? null
  const viewRun = selected !== null ? runs[selected] : undefined

  useEffect(() => {
    if (viewRun && !events[viewRun.run_id]) void pullEvents(viewRun.run_id).catch(() => {})
  }, [viewRun, events, pullEvents])

  const floor = useMemo(() => buildFloor(viewRun ? (events[viewRun.run_id] ?? []) : []), [viewRun, events])
  const viewEvents = viewRun ? (events[viewRun.run_id] ?? []) : []
  const latestHandoff = floor.handoffs[floor.handoffs.length - 1]
  const viewRunning = viewRun?.status === 'running'
  // A model request that hasn't answered for a while is the AI provider being slow, not the board.
  const lastStepAt = viewEvents.length ? new Date(viewEvents[viewEvents.length - 1].time).getTime() : null
  const quietFor = viewRunning && lastStepAt ? Math.floor((now - lastStepAt) / 1000) : 0

  // --- actions ------------------------------------------------------------------------------------
  const startRun = async () => {
    if (!ticket) return
    setStarting(true)
    try {
      const r = await api.runTicket(ticket.id)
      lastSeq.current[r.run_id] = -1
      setEvents((all) => ({ ...all, [r.run_id]: [] }))
      setRuns((all) => ({ ...all, [r.ticket_id]: r }))
      toast('info', `Ticket #${ticket.id} is on the Boss's desk.`)
    } catch (e) {
      toast('bad', errText(e))
    } finally {
      setStarting(false)
    }
  }

  // The human's decision may have been the last thing a finished ticket was waiting on.
  const announceIfResolved = (a: Approval, fresh: Approval[] | null) => {
    const id = a.ticket_id
    if (id !== null && fresh !== null && runs[id]?.status === 'finished' && waitingFor(fresh, id) === 0) {
      toast('good', `Ticket #${id} resolved. You've signed everything it needed.`)
    }
  }

  const approve = async (a: Approval) => {
    try {
      const res = await api.approve(a.id, signer.trim())
      setDecided((d) => [{ approval: a, verdict: 'approved', by: signer.trim(), message: res.message }, ...d])
      toast('good', res.message)
      announceIfResolved(a, await refresh())
      return null
    } catch (e) {
      return errText(e)
    }
  }

  const reject = async (a: Approval, reason: string) => {
    try {
      const res = await api.reject(a.id, signer.trim(), reason)
      setDecided((d) => [{ approval: a, verdict: 'rejected', by: signer.trim(), message: res.message }, ...d])
      toast('info', res.message)
      announceIfResolved(a, await refresh())
      return null
    } catch (e) {
      return errText(e)
    }
  }

  const reset = async () => {
    if (!window.confirm('Reset the shop data to the original database? This clears approvals, drafts, and payments.')) return
    try {
      const res = await api.reset()
      setRuns({})
      setEvents({})
      setDecided([])
      lastSeq.current = {}
      toast('info', res.message)
      await refresh()
    } catch (e) {
      toast('bad', errText(e))
    }
  }

  const waitingHere = ticket ? waitingFor(approvals, ticket.id) : 0
  const state = ticket ? boardState(ticket, viewRun, waitingHere) : 'open'
  const busyElsewhere = !!activeRun && activeRun.ticket_id !== ticket?.id
  const canRun = online && ticket && ticket.state !== 'resolved' && !activeRun && !starting

  return (
    <div className="app">
      <div className="desk">
        <header className="desk-header">
          <div className="brand">
            <Logo variant="light" />
            <div className="brand-copy">
              <span className="eyebrow eyebrow-light">Campus Customs · Back office</span>
              <h1>The Agent Desk</h1>
              <p>Five agents, one ticket at a time. Nothing gets paid until you sign.</p>
              <span className={`conn conn-${online === null ? 'wait' : online ? 'on' : 'off'}`}>
                <i />
                {online === null ? 'Connecting…' : online ? `Backend connected · team model ${health?.model ?? ''}` : 'Backend offline: start uvicorn on port 8000'}
              </span>
            </div>
          </div>

          <div className="cash-card" aria-label="Checking balance">
            <span className="cash-label">Checking balance</span>
            <SlotBalance value={cash?.balance ?? null} />
            <span className="cash-sub">
              {cash ? `as of ${cash.as_of}` : 'loading…'}
              {cash && cash.committed_purchase_orders > 0 && (
                <>
                  {' '}
                  · {money(cash.committed_purchase_orders)} committed to orders · {money(cash.balance_after_committed_orders)} free
                </>
              )}
            </span>
          </div>
        </header>

        <main className="desk-grid">
          <aside className="col col-left">
            <section className="panel" aria-labelledby="tray-h">
              <div className="panel-head">
                <span className="eyebrow">Ticket tray</span>
                <h2 id="tray-h">Tickets</h2>
              </div>
              <TicketTray tickets={tickets} runs={runs} approvals={approvals} selected={selected} onSelect={setSelected} />
            </section>
          </aside>

          <section className="col col-center">
            <section className="panel floor-panel" aria-labelledby="floor-h">
              <div className="panel-head floor-head">
                <div>
                  <span className="eyebrow">The floor</span>
                  <h2 id="floor-h">Agent team</h2>
                </div>
                {viewRunning && viewRun && (
                  <span className="run-clock">
                    <span className="pulse-dot" /> Working on #{viewRun.ticket_id} · {elapsed(viewRun.started_at, now)}
                  </span>
                )}
                {viewRunning && quietFor >= 20 && (
                  <span className="slow-note" role="status">
                    Waiting on the AI model for {quietFor}s. A stalled request is retried automatically after 45s.
                  </span>
                )}
              </div>

              <div className="floor">
                <div className="floor-top">
                  <div className={`on-desk state-${state}`}>
                    <span className="eyebrow">On the desk</span>
                    {ticket ? (
                      <>
                        <h3>
                          #{ticket.id} · {ticket.subject}
                        </h3>
                        <p className="small muted">
                          {prettyType(ticket.type)} from {ticket.requester}
                        </p>
                        {state === 'resolved' ? (
                          <p className="resolved-line">✓ Resolved. Nothing is left for a human to do.</p>
                        ) : state === 'waiting' ? (
                          <p className="waiting-line">
                            Team done, waiting on you: {waitingHere === 1 ? '1 request needs' : `${waitingHere} requests need`} your signature →
                          </p>
                        ) : state === 'running' ? (
                          <p className="working-line">The team is on it…</p>
                        ) : null}
                        {ticket.state !== 'resolved' && (
                          <button type="button" className="btn btn-primary" disabled={!canRun} onClick={() => void startRun()}>
                            {starting ? 'Sending…' : state === 'running' ? 'Team working…' : viewRun ? 'Run the team again' : 'Send to the agent team'}
                          </button>
                        )}
                        {busyElsewhere && <p className="small muted">Busy with #{activeRun!.ticket_id}. One ticket at a time.</p>}
                      </>
                    ) : (
                      <p className="small muted">Pick a ticket from the tray.</p>
                    )}
                  </div>

                  <AgentStation state={floor.agents.boss} running={viewRunning} />

                  <ApprovalsPanel
                    approvals={approvals}
                    cash={cash}
                    signer={signer}
                    onSigner={setSigner}
                    onApprove={approve}
                    onReject={reject}
                    decided={decided}
                  />
                </div>

                <div className="handoff-ribbon" aria-live="polite">
                  <span className="eyebrow">Latest hand-off</span>
                  {latestHandoff ? (
                    <p title={latestHandoff.task}>
                      <strong>
                        {agentName(latestHandoff.from)} <span>→</span> {agentName(latestHandoff.to)}
                      </strong>{' '}
                      {latestHandoff.task}
                    </p>
                  ) : (
                    <p className="muted">When the Boss passes work to a teammate, it shows up here.</p>
                  )}
                  {floor.handoffs.length > 0 && <span className="handoff-count">{floor.handoffs.length} so far</span>}
                </div>

                <div className="floor-row">
                  {(['inventory', 'accounting', 'facilities', 'customer_service'] as const).map((id) => (
                    <AgentStation key={id} state={floor.agents[id]} running={viewRunning} />
                  ))}
                </div>
              </div>
            </section>

            {viewRun && viewRun.status !== 'running' && <RunSummary floor={floor} run={viewRun} waiting={waitingHere} />}
          </section>

          <aside className="col col-right">
            <DeskLog events={viewEvents} running={viewRunning} />
          </aside>
        </main>

        <footer className="desk-footer">
          <p>
            Agents only <strong>prepare</strong> payments and purchase orders. Money moves only when a human signs. Shop data comes
            from the campus-customs MCP server.
          </p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void reset()} disabled={!online || !!activeRun}>
            Reset shop data
          </button>
        </footer>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
