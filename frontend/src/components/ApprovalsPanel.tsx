import { useState } from 'react'
import type { Approval, Cash } from '../api.ts'
import { agentName, money } from '../floor.ts'

export interface Decided {
  approval: Approval
  verdict: 'approved' | 'rejected'
  by: string
  message: string
}

function title(a: Approval): string {
  if (a.kind === 'invoice_payment') return `Pay invoice ${a.ref_id}`
  if (a.kind === 'rent_payment') return `Pay rent · lease ${a.ref_id}`
  if (a.kind === 'purchase_order') return `Purchase order · ${a.qty} × ${a.sku}${a.size ? ` ${a.size}` : ''}`
  return a.kind.replace(/_/g, ' ')
}

/** What approving would do to cash, worked out from the live balance (the backend re-checks it). */
function cashNote(a: Approval, cash: Cash | null): { ok: boolean; text: string } | null {
  if (!cash) return null
  const free = cash.balance_after_committed_orders
  const left = free - a.amount
  if (a.kind === 'purchase_order') {
    return left >= 0
      ? { ok: true, text: `Places the order. No cash moves now; it commits ${money(a.amount)}, leaving ${money(left)} uncommitted.` }
      : { ok: false, text: `⚠ Warning: this ${money(a.amount)} order is more than the ${money(free)} of cash on hand, so approving it would push cash negative. The desk will refuse it until cash covers it; you can still reject it.` }
  }
  return left >= 0
    ? { ok: true, text: `Pays it now. Checking drops to ${money(cash.balance - a.amount)}.` }
    : { ok: false, text: `⚠ Warning: this ${money(a.amount)} payment is more than the ${money(free)} of cash on hand, so paying it would push cash negative. The desk will refuse it until cash covers it; you can still reject it.` }
}

interface Props {
  approvals: Approval[]
  cash: Cash | null
  signer: string
  onSigner: (name: string) => void
  onApprove: (a: Approval) => Promise<string | null> // returns an error message, or null on success
  onReject: (a: Approval, reason: string) => Promise<string | null>
  decided: Decided[]
}

function ApprovalCard({ a, cash, signed, onApprove, onReject }: { a: Approval; cash: Cash | null; signed: boolean } & Pick<Props, 'onApprove' | 'onReject'>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const note = cashNote(a, cash)

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    const err = await fn()
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <li className={`approval kind-${a.kind}`}>
      <div className="approval-head">
        <span className="approval-title">{title(a)}</span>
        <span className="approval-amount">{money(a.amount)}</span>
      </div>
      <p className="approval-who">
        Prepared by <strong>{agentName(a.prepared_by)}</strong>
        {a.ticket_id ? ` for ticket #${a.ticket_id}` : ''} · from {a.account}
      </p>
      {a.reason && (
        <p className="approval-reason" title={a.reason}>
          “{a.reason}”
        </p>
      )}
      {note && <p className={`approval-cash ${note.ok ? 'ok' : 'warn'}`}>{note.text}</p>}
      {error && (
        <p className="approval-error" role="alert">
          {error}
        </p>
      )}

      {rejecting ? (
        <form
          className="reject-form"
          onSubmit={(e) => {
            e.preventDefault()
            void act(() => onReject(a, reason.trim()))
          }}
        >
          <label className="small" htmlFor={`reason-${a.id}`}>
            Why are you rejecting it? (the team sees this)
          </label>
          <textarea id={`reason-${a.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <div className="approval-actions">
            <button type="submit" className="btn btn-reject" disabled={busy || !signed || !reason.trim()}>
              Confirm reject
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="approval-actions">
          <button type="button" className="btn btn-approve" disabled={busy || !signed} onClick={() => void act(() => onApprove(a))}>
            {busy ? 'Signing…' : 'Approve'}
          </button>
          <button type="button" className="btn btn-reject" disabled={busy || !signed} onClick={() => setRejecting(true)}>
            Reject
          </button>
        </div>
      )}
    </li>
  )
}

/**
 * "Needs your signature": the only place money moves, and only when a human clicks Approve.
 * It sits at the top right of the agent floor and lights up yellow when something is waiting.
 */
export default function ApprovalsPanel({ approvals, cash, signer, onSigner, onApprove, onReject, decided }: Props) {
  const signed = signer.trim().length >= 2
  const hot = approvals.length > 0
  return (
    <section className={`approvals-card ${hot ? 'is-hot' : 'is-calm'}`} aria-labelledby="approvals-h" aria-live="polite">
      <div className="approvals-head">
        <span className="eyebrow">{hot ? '✍ Your turn' : 'Human approval'}</span>
        <h2 id="approvals-h">
          Needs your signature
          {hot && <span className="count-badge">{approvals.length}</span>}
        </h2>
        {hot && <p className="your-turn">The team prepared {approvals.length === 1 ? 'a request' : `${approvals.length} requests`}. Nothing moves until you decide.</p>}
      </div>
      <label className="signer">
        <span>Signing as</span>
        <input value={signer} onChange={(e) => onSigner(e.target.value)} placeholder="Your name" maxLength={60} />
      </label>
      {!signed && hot && <p className="small sign-hint">Type your name to sign. Agents can only prepare; you decide.</p>}

      {approvals.length === 0 ? (
        <p className="empty small muted">Nothing to sign right now. When an agent prepares a payment or purchase order, it lands here and this card lights up.</p>
      ) : (
        <ul className="approval-list">
          {approvals.map((a) => (
            <ApprovalCard key={a.id} a={a} cash={cash} signed={signed} onApprove={onApprove} onReject={onReject} />
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <div className="decided">
          <span className="eyebrow">Signed this session</span>
          <ul>
            {decided.map((d) => (
              <li key={d.approval.id} className={`decided-${d.verdict}`} title={d.message}>
                <span>{d.verdict === 'approved' ? '✓' : '✕'}</span> {title(d.approval)} · {money(d.approval.amount)} · {d.verdict} by {d.by}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
