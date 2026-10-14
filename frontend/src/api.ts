/**
 * Every call the board makes to the FastAPI backend (backend/main.py, Problem 7).
 * The backend runs at http://localhost:8000 and allows this page's origin (http://localhost:5173).
 */

export const API_BASE = 'http://localhost:8000'

export type AgentName = 'boss' | 'inventory' | 'accounting' | 'facilities' | 'customer_service'

export interface Ticket {
  id: number
  type: string
  requester: string
  subject: string
  sku: string | null
  size: string | null
  qty: number | null
  lease_id: number | null
  invoice_id: number | null
  status: string // the desk's own status: open, in_progress, waiting_on_human, resolved, escalated
  created_at: string
  state: 'open' | 'resolved'
}

export interface TicketOutcome {
  ticket_id: number
  ticket_type: string
  assigned_to: AgentName[]
  decision: string
  summary_for_human: string
  approval_ids: number[]
  draft_ids: number[]
  final_status: string
  blocked_by: string[]
  guardrail_notes: string[]
}

export interface RunInfo {
  run_id: string
  ticket_id: number
  status: 'running' | 'finished' | 'failed'
  started_at: string
  finished_at?: string
  outcome?: TicketOutcome
  error?: string
}

export interface DeskEvent {
  seq: number
  time: string
  run_id: string
  ticket_id: number | null
  agent: string // an AgentName, or "team" for ticket_start / ticket_end
  depth: number
  event: string
  model: string
  said: string[]
  tools: string[]
  detail: Record<string, unknown>
}

export interface Approval {
  id: number
  kind: 'invoice_payment' | 'rent_payment' | 'purchase_order' | string
  ref_id: number | null
  vendor_id: number | null
  sku: string | null
  size: string | null
  qty: number | null
  amount: number
  account: string
  ticket_id: number | null
  prepared_by: string
  reason: string | null
  status: string
  created_at: string
}

export interface Cash {
  account: string
  balance: number
  as_of: string
  committed_purchase_orders: number
  balance_after_committed_orders: number
}

export interface Health {
  status: string
  model: string
  active_run: string | null
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch {
    throw new ApiError(0, `Can't reach the backend at ${API_BASE}. Is uvicorn running?`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = body?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).join('; ')
          : `Request failed (${res.status})`
    throw new ApiError(res.status, message)
  }
  return body as T
}

const post = (body?: unknown) =>
  ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) satisfies RequestInit

export const api = {
  health: () => call<Health>('/health'),
  tickets: () => call<{ tickets: Ticket[] }>('/tickets').then((r) => r.tickets),
  runTicket: (id: number) => call<RunInfo>(`/tickets/${id}/run`, post()),
  run: (runId: string) => call<RunInfo>(`/runs/${runId}`),
  events: (runId: string, after?: number) =>
    call<{ events: DeskEvent[]; last_seq: number }>(
      `/events?run_id=${runId}&limit=500${after === undefined ? '' : `&after=${after}`}`,
    ),
  approvals: () => call<{ approvals: Approval[] }>('/approvals').then((r) => r.approvals),
  approve: (id: number, approvedBy: string) =>
    call<{ message: string; balance_after?: number }>(`/approvals/${id}/approve`, post({ approved_by: approvedBy })),
  reject: (id: number, rejectedBy: string, reason: string) =>
    call<{ message: string }>(`/approvals/${id}/reject`, post({ rejected_by: rejectedBy, reason })),
  cash: () => call<Cash>('/cash'),
  reset: () => call<{ message: string }>('/reset', post()),
}
