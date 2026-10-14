import type { Approval, Ticket } from '../api.ts'
import { boardState, prettyType, type BoardRun, type BoardState } from '../floor.ts'

const CHIP: Record<BoardState, string> = {
  open: 'Open',
  running: 'Team working',
  waiting: 'Team done, waiting on human',
  resolved: 'Resolved',
  failed: 'Run failed',
}

function detailLine(t: Ticket): string {
  const bits: string[] = []
  if (t.sku) bits.push([t.sku, t.size && `size ${t.size}`, t.qty && `qty ${t.qty}`].filter(Boolean).join(' · '))
  if (t.lease_id) bits.push(`Lease ${t.lease_id}`)
  if (t.invoice_id) bits.push(`Invoice ${t.invoice_id}`)
  return bits.join(' · ')
}

interface Props {
  tickets: Ticket[]
  runs: Record<number, BoardRun>
  approvals: Approval[]
  selected: number | null
  onSelect: (id: number) => void
}

/** The ticket tray: every ticket with an open / working / resolved chip. Click one to pick it. */
export default function TicketTray({ tickets, runs, approvals, selected, onSelect }: Props) {
  if (!tickets.length) return <p className="muted small empty">No tickets yet. Is the backend running?</p>
  return (
    <ul className="tray" role="listbox" aria-label="Tickets">
      {tickets.map((t) => {
        const waiting = approvals.filter((a) => a.ticket_id === t.id).length
        const state = boardState(t, runs[t.id], waiting)
        return (
          <li key={t.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected === t.id}
              className={`ticket-card state-${state} ${selected === t.id ? 'is-selected' : ''}`}
              onClick={() => onSelect(t.id)}
            >
              <span className="ticket-top">
                <span className="ticket-id">#{t.id}</span>
                <span className={`chip chip-${state}`}>
                  {state === 'resolved' && <span aria-hidden="true">✓ </span>}
                  {state === 'waiting' && <span aria-hidden="true">✍ </span>}
                  {state === 'running' && <span className="pulse-dot" aria-hidden="true" />}
                  {CHIP[state]}
                </span>
              </span>
              <span className="ticket-subject">{t.subject}</span>
              <span className="ticket-from">
                {prettyType(t.type)} · from {t.requester}
              </span>
              {detailLine(t) && <span className="ticket-detail">{detailLine(t)}</span>}
              {(waiting > 0 || ((state === 'resolved' || state === 'waiting') && t.status !== 'resolved')) && (
                <span className="ticket-foot">
                  {waiting > 0 && <span className="sign-flag">✍ {waiting} waiting for your signature</span>}
                  {(state === 'resolved' || state === 'waiting') && t.status !== 'resolved' && (
                    <span className="desk-status">Desk status: {t.status.replace(/_/g, ' ')}</span>
                  )}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
