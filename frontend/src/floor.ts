/**
 * Turns the backend's audit events into what the board shows: who is working, what each agent
 * is saying, which tools they used, and a short summary of each agent's part in the ticket.
 */
import type { AgentName, DeskEvent, RunInfo, Ticket, TicketOutcome } from './api.ts'

export const AGENTS: { id: AgentName; name: string; role: string; outfit: string }[] = [
  { id: 'boss', name: 'Boss', role: 'Reads the ticket, hands out the work, makes the final call', outfit: 'Navy suit, white blouse, Yale-blue pin' },
  { id: 'inventory', name: 'Inventory', role: 'Stock by SKU and size, shortfalls, restock vendors', outfit: 'Hi-vis vest, hard hat, a box on the desk' },
  { id: 'accounting', name: 'Accounting', role: 'Cash, invoices, margins; prepares payments for you', outfit: 'Green eyeshade, sweater vest, calculator' },
  { id: 'facilities', name: 'Facilities', role: 'Lease, rent, and the shop space', outfit: 'Work coveralls, cap, wrench and toolbox' },
  { id: 'customer_service', name: 'Customer Service', role: 'Drafts polite, clear replies to customers', outfit: 'Headset, cardigan, name tag' },
]

export const agentName = (id: string | null | undefined): string =>
  AGENTS.find((a) => a.id === id)?.name ??
  (id === 'team' ? 'Desk' : id === 'human' ? 'Human' : id ? id.replace(/_/g, ' ') : 'the desk')

export const isAgent = (id: string): id is AgentName => AGENTS.some((a) => a.id === id)

type Args = Record<string, unknown>

/** PydanticAI's own tool for handing back the structured answer; not a shop tool, so the board hides it. */
export const INTERNAL_TOOLS = new Set(['final_result'])
const shopCalls = (calls: unknown) =>
  ((calls as { tool: string; args?: Args }[] | undefined) ?? []).filter((c) => !INTERNAL_TOOLS.has(c.tool))

/** Plain-English line for one MCP tool call, so the board reads like people talking. */
export function toolPhrase(tool: string, args: Args = {}): string {
  const a = (k: string) => (args[k] === undefined || args[k] === null ? '' : String(args[k]))
  const item = [a('sku'), a('size') && `size ${a('size')}`].filter(Boolean).join(' ')
  switch (tool) {
    case 'get_ticket':
      return `Reading ticket ${a('ticket_id')}.`
    case 'get_shop_date':
      return "Checking today's date at the shop."
    case 'list_open_tickets':
    case 'list_tickets':
      return 'Looking over the ticket tray.'
    case 'update_ticket_status':
      return `Marking ticket ${a('ticket_id')} as "${a('status').replace(/_/g, ' ')}".`
    case 'check_stock':
      return `Counting ${item || 'stock'} on the shelf${a('qty_needed') ? ` (need ${a('qty_needed')})` : ''}.`
    case 'find_restock_vendors':
      return `Looking up who can restock ${a('sku') || 'this item'}.`
    case 'get_invoice_status':
      return `Pulling invoice ${a('invoice_id')}.`
    case 'check_margin':
      return `Running the margin on ${item || 'this item'}.`
    case 'get_cash_position':
      return 'Checking the cash position.'
    case 'prepare_payment':
      return `Preparing a ${a('kind') || ''} payment for a human to approve.`.replace('  ', ' ')
    case 'prepare_purchase_order':
      return `Writing up a purchase order${a('qty') ? ` for ${a('qty')} × ${item}` : ''} for a human to approve.`
    case 'list_pending_approvals':
      return "Checking what's waiting for approval."
    case 'get_rent_status':
      return `Reading lease ${a('lease_id')}.`
    case 'draft_customer_message':
      return `Drafting a note to ${a('recipient') || 'the customer'}.`
    case 'list_message_drafts':
      return 'Reviewing the message drafts.'
    case 'delegate':
      return `Asking ${agentName(a('to_agent'))}: ${a('task')}`
    default:
      return `Using ${tool}.`
  }
}

export interface Draft {
  recipient: string
  subject: string
  body: string
}

export interface AgentState {
  id: AgentName
  status: 'idle' | 'working' | 'done' | 'error'
  active: number // how many copies of this agent are working right now (delegations can overlap)
  line: string | null // latest thing the agent said or did
  tool: string | null // latest tool
  askedBy: string[] // who handed this agent work
  tasks: string[]
  tools: Record<string, number> // tool -> times used
  answers: string[]
  actions: string[]
  unknowns: string[]
  drafts: Draft[] // only drafts the tool actually saved (rejected drafts never reach the board)
  draftAttempts: Draft[] // drafts sent to the tool and not yet confirmed by a tool result
  lastSeq: number
}

export interface Handoff {
  from: string
  to: string
  task: string
  seq: number
}

export interface Floor {
  agents: Record<AgentName, AgentState>
  handoffs: Handoff[]
  outcome: TicketOutcome | null
  stats: { delegations: number; modelSteps: number } | null
  error: string | null
  lastSeq: number
}

const blank = (id: AgentName): AgentState => ({
  id,
  status: 'idle',
  active: 0,
  line: null,
  tool: null,
  askedBy: [],
  tasks: [],
  tools: {},
  answers: [],
  actions: [],
  unknowns: [],
  drafts: [],
  draftAttempts: [],
  lastSeq: -1,
})

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])

export function buildFloor(events: DeskEvent[]): Floor {
  const agents = Object.fromEntries(AGENTS.map((a) => [a.id, blank(a.id)])) as Record<AgentName, AgentState>
  const floor: Floor = { agents, handoffs: [], outcome: null, stats: null, error: null, lastSeq: -1 }

  for (const e of events) {
    floor.lastSeq = Math.max(floor.lastSeq, e.seq)
    const d = e.detail
    if (e.event === 'ticket_end') {
      floor.outcome = (d.outcome as TicketOutcome) ?? null
      floor.stats = { delegations: Number(d.delegations ?? 0), modelSteps: Number(d.model_steps ?? 0) }
      continue
    }
    if (e.event === 'ticket_error') {
      floor.error = String(d.stop_reason ?? 'The run failed.')
      continue
    }
    if (!isAgent(e.agent)) continue
    const s = agents[e.agent]
    s.lastSeq = e.seq

    switch (e.event) {
      case 'agent_start': {
        s.active += 1
        const from = (d.delegated_by as string | null) ?? 'desk'
        if (!s.askedBy.includes(from)) s.askedBy.push(from)
        s.tasks.push(String(d.task ?? ''))
        s.line = from === 'desk' ? 'Picking up the ticket.' : `${agentName(from)} asked me: ${d.task ?? ''}`
        break
      }
      case 'model_step': {
        const text = strs(d.text).join(' ').trim()
        for (const c of shopCalls(d.tool_calls)) {
          s.tool = c.tool
          s.line = toolPhrase(c.tool, c.args)
          if (c.tool === 'draft_customer_message' && c.args) {
            s.draftAttempts.push({
              recipient: String(c.args.recipient ?? ''),
              subject: String(c.args.subject ?? ''),
              body: String(c.args.body ?? ''),
            })
          }
        }
        if (text) s.line = text
        break
      }
      case 'tool_results':
        for (const r of shopCalls(d.results) as { tool: string; result?: unknown; error?: unknown }[]) {
          s.tools[r.tool] = (s.tools[r.tool] ?? 0) + 1
          if (r.tool === 'draft_customer_message') {
            const attempt = s.draftAttempts.shift()
            const text = String(r.result ?? '')
            const saved = !r.error && text.includes('"draft"') && !/^draft rejected/i.test(text.trim())
            if (attempt && saved) s.drafts.push(attempt)
          }
        }
        break
      case 'delegation':
        floor.handoffs.push({ from: e.agent, to: String(d.to_agent), task: String(d.task ?? ''), seq: e.seq })
        s.tool = 'delegate'
        s.line = `Handing this to ${agentName(String(d.to_agent))}: ${d.task ?? ''}`
        break
      case 'delegation_refused':
        s.line = `Couldn't hand off to ${agentName(String(d.to_agent))}: ${d.reason ?? ''}`
        break
      case 'agent_end': {
        s.active = Math.max(0, s.active - 1)
        const out = d.output as Record<string, unknown> | string | undefined
        if (out && typeof out === 'object') {
          const answer = String(out.answer ?? out.decision ?? '')
          if (answer) s.answers.push(answer)
          s.actions.push(...strs(out.actions_taken))
          s.unknowns.push(...strs(out.unknowns))
          s.line = answer || s.line
        } else if (out) {
          s.answers.push(String(out))
          s.line = String(out)
        }
        break
      }
      case 'agent_stopped':
      case 'agent_error':
        s.active = Math.max(0, s.active - 1)
        s.status = 'error'
        s.line = String(d.stop_reason ?? 'Stopped.')
        break
    }
  }

  for (const s of Object.values(agents)) {
    if (s.active > 0) s.status = 'working'
    else if (s.status !== 'error') s.status = s.answers.length ? 'done' : 'idle'
  }
  return floor
}

/** One readable line per event for the desk log (tool results are counted, not listed). */
export function logLine(e: DeskEvent): { kind: 'start' | 'say' | 'handoff' | 'answer' | 'system' | 'error' | 'human'; text: string } | null {
  const d = e.detail
  switch (e.event) {
    case 'human_decision':
    case 'ticket_resolved':
      return { kind: 'human', text: e.said[0] ?? '' }
    case 'ticket_start':
      return { kind: 'system', text: `Ticket ${e.ticket_id} sent to the team.` }
    case 'ticket_end': {
      const o = d.outcome as TicketOutcome | undefined
      return { kind: 'system', text: `Run finished. Final status: ${(o?.final_status ?? 'done').replace(/_/g, ' ')}.` }
    }
    case 'ticket_error':
      return { kind: 'error', text: String(d.stop_reason ?? 'The run failed.') }
    case 'agent_start':
      return d.delegated_by
        ? { kind: 'start', text: `Picked up a task from ${agentName(String(d.delegated_by))}.` }
        : { kind: 'start', text: 'Picked up the ticket.' }
    case 'model_step': {
      const text = strs(d.text).join(' ').trim()
      const calls = shopCalls(d.tool_calls).filter((c) => c.tool !== 'delegate')
      const parts = [text, ...calls.map((c) => toolPhrase(c.tool, c.args))].filter(Boolean)
      return parts.length ? { kind: 'say', text: parts.join(' ') } : null
    }
    case 'delegation':
      return { kind: 'handoff', text: String(d.task ?? '') }
    case 'delegation_refused':
      return { kind: 'error', text: `Hand-off to ${agentName(String(d.to_agent))} refused: ${d.reason ?? ''}` }
    case 'agent_end':
      return e.said.length ? { kind: 'answer', text: e.said[0] } : null
    case 'agent_stopped':
    case 'agent_error':
      return { kind: 'error', text: String(d.stop_reason ?? 'Stopped.') }
    default:
      return null
  }
}

export const prettyType = (t: string) => t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

/** A run started from this board, remembered in localStorage so a reload keeps the ticket's result. */
export type BoardRun = Pick<RunInfo, 'run_id' | 'ticket_id' | 'status' | 'started_at' | 'finished_at' | 'error'>

export type BoardState = 'open' | 'running' | 'waiting' | 'resolved' | 'failed'

/**
 * Where a ticket stands on the board. When the team's run finishes, the ticket is "waiting" (yellow)
 * while any payment or purchase order it prepared still needs a human decision, and "resolved"
 * (green) once none do. Pending approvals are the human task, because they are what the board lets
 * a human finish; customer drafts stay on the board and are never sent.
 */
export function boardState(t: Ticket, run: BoardRun | undefined, pendingForTicket: number): BoardState {
  if (run?.status === 'running') return 'running'
  if (run?.status === 'failed') return 'failed'
  if (run?.status === 'finished') return pendingForTicket > 0 ? 'waiting' : 'resolved'
  if (t.state === 'resolved') return 'resolved'
  return 'open'
}

