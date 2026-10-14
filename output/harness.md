# Campus Customs Harness

What this harness covers: the database tables (shop tables and board tables), the MCP tools, the five agents, the backend API routes, the React dashboard, the safety rules, and the Problem 9 run that resolved all three tickets.

How to set up and run everything (reset the database, start the MCP server, the FastAPI backend, and the React board) is in the project `README.md`.

Agents and tools read and write the working copy `data/campus_customs_new.db`. The original `data/campus_customs.db` is never modified. To reset, copy the original over the working copy, and do that before every full ticket run.

## Database tables

### desk
Fields: `date_today` (TEXT, required), `notes` (TEXT)

Why it matters: `date_today` (currently 2026-08-31) is the shop's "today", so every agent uses it to decide what is overdue or due soon instead of the real clock.

### tickets
Fields: `id` (INTEGER, PK), `type` (TEXT, required), `requester` (TEXT, required), `subject` (TEXT, required), `sku` (TEXT), `size` (TEXT), `qty` (INTEGER), `lease_id` (INTEGER, FK → leases.id), `invoice_id` (INTEGER, FK → invoices.id), `status` (TEXT, required), `notes` (TEXT), `created_at` (TEXT, required)

Why it matters: this is the work queue the boss reads and routes, and its optional link fields point each ticket at the inventory, lease, or invoice it is about.

### inventory
Fields: `sku` (TEXT, PK part), `name` (TEXT, required), `size` (TEXT, PK part), `qty` (INTEGER, required), `location` (TEXT, required)

Why it matters: Inventory checks stock by `(sku, size)` here to fill orders and find shortfalls.

### pricing
Fields: `sku` (TEXT, PK), `unit_cost` (REAL, required), `list_price` (REAL, required)

Why it matters: Accounting uses cost versus list price to check margins on discount requests and to price purchase orders. Pricing is per SKU, not per size.

### vendors
Fields: `id` (INTEGER, PK), `name` (TEXT, required), `specialty` (TEXT, required), `lead_days` (INTEGER, required)

Why it matters: Inventory matches a restock to a vendor by `specialty`, and `lead_days` is the only valid source for restock lead times.

### invoices
Fields: `id` (INTEGER, PK), `vendor_id` (INTEGER, required, FK → vendors.id), `amount` (REAL, required), `due_date` (TEXT, required), `status` (TEXT, required), `description` (TEXT)

Why it matters: an `open` invoice is money owed. It blocks that vendor from shipping new product, and it is overdue once `due_date` < `desk.date_today`.

### leases
Fields: `id` (INTEGER, PK), `space_name` (TEXT, required), `landlord` (TEXT, required), `monthly_rent` (REAL, required), `next_due` (TEXT, required), `notes` (TEXT)

Why it matters: Facilities uses this for rent amount and timing. After an approved rent payment, `next_due` must advance.

### cash_accounts
Fields: `name` (TEXT, PK), `balance` (REAL, required), `date` (TEXT, required)

Why it matters: this is the only source of cash (checking holds $3,400.00). The pay tool must refuse any payment that would make the balance negative, and cash only goes out because there is no revenue.

### payments
Fields: `id` (INTEGER, PK), `kind` (TEXT, required), `ref_id` (INTEGER), `amount` (REAL, required), `account` (TEXT, required), `paid_at` (TEXT, required), `approved_by` (TEXT, required)

Why it matters: this is the audit trail for money out (empty at start). Every row must record the human who approved it, and writing a row must happen together with updating the cash balance and the paid invoice or lease.

### Board tables (created by the MCP server in the working copy)
These three tables aren't in the original database. The MCP server creates them in `campus_customs_new.db` on its first write, so a reset (copying the original back) clears them.

- **approvals**: `id` (PK), `kind` (`invoice_payment` / `rent_payment` / `purchase_order`), `ref_id` (invoice or lease id), `vendor_id`, `sku`, `size`, `qty`, `amount`, `account`, `ticket_id`, `prepared_by` (agent), `reason`, `status` (`pending` / `approved` / `rejected` / `paid`), `created_at`, `decided_by` (human), `decided_at`.
  Why it matters: this is where agents *prepare* money moves and humans decide them. Nothing pays until a human approves.
- **message_drafts**: `id` (PK), `ticket_id`, `recipient`, `subject`, `body`, `drafted_by`, `status` (always `draft`), `created_at`.
  Why it matters: every customer, vendor, or landlord message waits here for a human to review. Nothing is ever sent.
- **ticket_updates**: `id` (PK), `ticket_id`, `status`, `note`, `updated_by`, `created_at`.
  Why it matters: this is the ticket's history. The Boss writes status notes, and each human approval or rejection adds a line, so the team sees decisions on the next run.

## How the open tickets link to other tables

| Ticket | Type | Links | What the data shows |
|---|---|---|---|
| 101 | `customer_order`, from Tauhid Zaman | `sku`/`size` → inventory and pricing; `invoice_id` 501 → invoices → vendors.id 1 | CC-TEE-WHITE size S has qty 0. Invoice 501 ($840, "Rush reprint CC-TEE-WHITE S") is `open` and was due 2026-08-28, so it is overdue. Bulldog Print Co (apparel reprint, 5 lead days) won't ship until it is paid. |
| 102 | `rent_notice`, from Elm City Properties | `lease_id` 1 → leases | Chapel Street shop rent of $2,400 is due 2026-09-02, two days after today. |
| 103 | `price_override`, from Yale AI Club | `sku`/`size` → inventory and pricing (no FK) | 20 × CC-HOOD-NAVY M requested, 8 on hand, so 12 short. Unit cost is $22 and list price is $58. A restock would also come from Bulldog Print Co, which is blocked by invoice 501. |

Notes for later problems:
- Cash is tight. Invoice 501 plus rent comes to $3,240 of the $3,400, which leaves $160. A 12-hoodie restock at cost would be $264, so not every request can be funded.
- Inventory has no vendor column. The vendor link is inferred from `vendors.specialty`: apparel goes to Bulldog Print Co, and mugs and small goods go to Elm City Gifts.
- Only `tickets → invoices`, `tickets → leases`, and `invoices → vendors` are real foreign keys. SKU links are matched by value.

## MCP tools (first three, Problem 3)

Server: `mcp_server/server.py` (FastMCP), working on `data/campus_customs_new.db`. These three tools are read-only and return only database values. If an ID doesn't exist, they return an error that lists the valid values. The full current list is in "All MCP tools" below.

### `check_stock(sku, size, qty_needed)`
- **Reads:** `inventory` (the row matching both `sku` and `size`; `qty` and `location`).
- **Unlocks:** Ticket 103 (Yale AI Club, 20 × CC-HOOD-NAVY size M).
- **Why this tool for that ticket:** No one can quote a bulk discount without knowing whether the hoodies exist. Called as `check_stock("CC-HOOD-NAVY", "M", 20)`, it returns 8 on hand and a shortfall of 12. That tells Inventory a restock is needed and tells Accounting that only 8 can ship now, before anyone prices the order. (It also confirms ticket 101's tee in size S is at 0.)

### `get_invoice_status(invoice_id)`
- **Reads:** `invoices` (the ticket's invoice and every other open invoice for the same vendor), `vendors` (name, specialty, `lead_days`), and `desk` (`date_today`).
- **Unlocks:** Ticket 101 (Tauhid Zaman, 1 × CC-TEE-WHITE size S, linked to `invoice_id` 501).
- **Why this tool for that ticket:** The tee is out of stock, and the only way to get more is a reprint from Bulldog Print Co. Called with 501, it shows the $840 invoice is open and 3 days overdue, so `vendor_will_ship` is false, and it gives the 5-day lead time. That tells the team the invoice must be paid, with human approval, before the customer's order can be promised.

### `get_rent_status(lease_id)`
- **Reads:** `leases` (`monthly_rent`, `next_due`, landlord), `desk` (`date_today`), and `cash_accounts` (`balance`).
- **Unlocks:** Ticket 102 (Elm City Properties rent notice, linked to `lease_id` 1).
- **Why this tool for that ticket:** Facilities needs to confirm the notice against the lease rather than trust the email. Called with 1, it shows $2,400 is due 2026-09-02, 2 days after the shop's today, and that checking ($3,400) covers it with $1,000 left. That's exactly what Accounting needs before preparing a rent payment for human approval.

## Agent team

Five PydanticAI agents live in `backend/agents/`, with one prompt each in `backend/prompts/` plus `shared_rules.md`. Data types are in `backend/models.py`. Every agent uses **gpt-6-luna through Portkey** (`PORTKEY_API_KEY`). The model name exists only once, in `backend/config.py`, and the app stops if `.env` names any other model.

All shop facts come from the campus-customs MCP server. The backend launches it over stdio with the same `run_server.py` as `.mcp.json`, and has no direct database access. Each agent sees only its own MCP allowlist plus `delegate`.

| Agent | Job | MCP tools it can call | Returns |
|---|---|---|---|
| **boss** (`agents/boss.py`) | Reads each ticket, routes it, makes the final call, sets ticket status | `list_open_tickets`, `get_ticket`, `get_shop_date`, `list_pending_approvals`, `list_message_drafts`, `update_ticket_status` | `TicketOutcome` (code check: can't be "resolved" with pending approvals) |
| **inventory** (`agents/inventory.py`) | Stock by SKU/size, shortfalls, which vendor can restock and when | `get_ticket`, `get_shop_date`, `check_stock`, `find_restock_vendors` | `AgentReport` |
| **accounting** (`agents/accounting.py`) | Cash, invoices, margins; *prepares* payments/POs for human approval | `get_ticket`, `get_shop_date`, `get_cash_position`, `get_invoice_status`, `check_margin`, `prepare_payment`, `prepare_purchase_order`, `list_pending_approvals` | `AgentReport` |
| **facilities** (`agents/facilities.py`) | Leases, rent amount and timing, checking notices against the lease | `get_ticket`, `get_shop_date`, `get_rent_status`, `list_pending_approvals` | `AgentReport` |
| **customer_service** (`agents/customer_service.py`) | Respectful, tailored, short drafts with a clear call to action (never sent) | `get_ticket`, `draft_customer_message`, `list_message_drafts` | `AgentReport` |

**Delegation (full connectivity):** every agent has `delegate(to_agent, task)` and can reach any other agent. Sub-runs share the caller's token budget. Three guards prevent loops: an agent can't delegate to itself or to an agent already working higher in the same chain, the maximum depth is 2 (boss → specialist → specialist), and a ticket gets at most 6 delegations.

**Audit:** `backend/agents/base.py` drives each agent loop with `agent.iter()`. It appends every step to `output/audit_trail.json`, which is append-only and never wiped. The events are `ticket_start`, `agent_start` (task, delegated_by), `model_step` (thinking, text, tool calls with args, finish reason, step and ticket token usage), `tool_results` (result preview or error), `delegation` / `delegation_refused`, `agent_end` / `agent_stopped` / `agent_error` (stop reason, output), and `ticket_end`. Every entry carries the time, run_id, ticket_id, agent, depth, and model. Human decisions and ticket resolutions are audited too: `POST /approvals/{id}/approve` and `/reject` append a `human_decision` event (`approved`, `rejected`, or `approve_refused` with the refusal and HTTP status), with `agent: "human"`, the approval id, kind, amount, and who decided. When the backend marks a ticket resolved, it adds a `ticket_resolved` event with the note and who resolved it. *(Added after the Problem 9 run. That run's four human actions were backfilled from the `approvals`, `payments`, and `ticket_updates` tables and are marked `backfilled: true`.)*

**Run:** `python backend/run_ticket.py 101`. Use `--all` to reset the database and then work every open ticket, or `--ask inventory "..."` to ask one agent.

## All MCP tools

The board tables (`approvals`, `message_drafts`, `ticket_updates`) are created in the working copy on first write, so resetting the database clears them. No agent tool changes vendors, pricing, inventory counts, leases, or cash balances. Only the human-only tools at the bottom of the table move money or close tickets for a human. They're registered only when the server is started with `--human-tools`, which only the FastAPI backend does.

| Tool | Tables | R/W | Used by | Purpose |
|---|---|---|---|---|
| `get_shop_date` | `desk` | R | boss, inventory, accounting, facilities | Shop's "today" for all due/overdue math |
| `list_open_tickets` | `tickets` | R | boss | Work queue (all non-resolved tickets) |
| `get_ticket` | `tickets`, `ticket_updates` | R | all | Full ticket, linked ids, history, **prompt-injection flags**, and `bulk_discount_policy` (whether the ticket's qty qualifies) |
| `update_ticket_status` | `tickets`, `approvals` (reads) → `ticket_updates` | W | boss | Set status and note; refuses "resolved" while approvals are pending |
| `check_stock` | `inventory` | R | inventory | On hand, shortfall, can-fill for SKU/size/qty |
| `find_restock_vendors` | `inventory`, `vendors`, `invoices`, `desk` | R | inventory | Every vendor's lead_days, open invoices, will_ship, arrival dates, SKU invoice history |
| `get_invoice_status` | `invoices`, `vendors`, `desk` | R | accounting | Amount, overdue days, vendor will ship, lead time |
| `check_margin` | `pricing` | R | accounting | Margin at list and at a proposed price/discount, break-even, below-cost flag, plus the bulk discount policy for that qty and the margin at the policy discount when it qualifies |
| `get_cash_position` | `cash_accounts`, `invoices`, `vendors`, `leases`, `desk`, `approvals` | R | accounting | Cash vs. open invoices, rent due in 30 days, pending approvals, and placed (approved) purchase orders not yet invoiced |
| `prepare_payment` | `invoices` / `leases`, `cash_accounts`, `tickets` → `approvals` | W | accounting | Queue an invoice or rent payment as **pending** (amount from DB). Always queued; one the cash can't cover carries a WARNING and `approvable_with_current_cash: false` |
| `prepare_purchase_order` | `vendors`, `inventory`, `pricing`, `invoices`, `desk`, `cash_accounts` → `approvals` | W | accounting | Queue a restock PO as **pending** (cost = unit_cost × qty). Flags a vendor blocked by an open invoice. Always queued, even when the order is more than the uncommitted cash; in that case it carries a WARNING and `approvable_with_current_cash: false`. |
| `list_pending_approvals` | `approvals` | R | boss, accounting, facilities | What is waiting for a human |
| `get_rent_status` | `leases`, `desk`, `cash_accounts` | R | facilities | Rent, due date, days until due, cash coverage |
| `draft_customer_message` | `tickets`, `vendors`, `leases`, `cash_accounts` → `message_drafts` | W | customer_service | Save a draft to the board (never sent); rejects internal or sensitive content, and in customer drafts any supplier/PO/approval/lead-time detail or date/timeframe |
| `list_message_drafts` | `message_drafts` | R | boss, customer_service | Drafts waiting for human review |
| `list_tickets` | `tickets` | R | dashboard (`GET /tickets`) | Every ticket, including resolved ones, with its status |
| `approve_request` | `approvals`, `invoices` / `leases` / `pricing`, `cash_accounts`, `desk` → `payments`, `cash_accounts`, `invoices` / `leases`, `approvals`, `ticket_updates` | W | **human only** (`POST /approvals/{id}/approve`) | **Invoice or rent:** pays in one transaction. It writes the `payments` row with `approved_by`, lowers cash, marks the invoice paid or moves the lease's `next_due` forward one month, and sets the approval to `paid`. It refuses if cash would go negative or would drop below what's committed to placed orders. **Purchase order:** places the order by setting the approval to `approved`. No payment is made and cash doesn't move; the vendor's invoice is paid later through its own approval. It refuses if the order plus orders already placed would be more than the account balance, or if that vendor has an open invoice; the refusal lists every reason, cash first. Both kinds are refused if the amount has changed since it was prepared. |
| `reject_request` | `approvals` → `approvals`, `ticket_updates` | W | **human only** (`POST /approvals/{id}/reject`) | Marks the request rejected with who decided and why. No money moves. |
| `resolve_ticket_if_done` | `tickets`, `approvals` → `tickets`, `ticket_updates` | W | **human side only** (backend, after a decision or a finished run) | Sets the ticket to `resolved` only if the Boss closed the run as `waiting_on_human` and none of its payments or orders is still pending. Logs a note naming the human whose decision finished it. Otherwise it changes nothing and says why. |

## Backend routes (Problem 7)

`backend/main.py` (FastAPI). Start it from `backend/` with `uvicorn main:app --reload --port 8000`. Every route gets its shop data from the MCP server.

- `GET /tickets` returns every ticket (101, 102, 103) with its status and a simple `state` of `open` or `resolved`.
- `POST /tickets/{ticket_id}/run` starts the agent team on one ticket in the background and returns a `run_id` right away (202). Only one run happens at a time.
- `GET /runs/{run_id}` reports whether that run is `running`, `finished`, or `failed`, plus the boss's final outcome.
- `GET /events?limit=&ticket_id=&run_id=&after=` returns recent audit-trail events, each showing the agent, what it said, and which tools it used. Pass `after` (the last `seq` you saw) to refresh the board with only new events.
- `GET /approvals?ticket_id=` lists the payments and purchase orders the agents prepared that are waiting for a human.
- `POST /approvals/{approval_id}/approve` (body `{"approved_by": "<human name>"}`) is how a human approves a request. Approving an invoice or rent payment pays it and lowers the checking balance; this is the only path that moves cash. Approving a purchase order places it without paying, and it's refused if the commitment would push cash negative. Agent names are refused.
- `POST /approvals/{approval_id}/reject` (body `{"rejected_by": "...", "reason": "..."}`) lets a human reject a request. No money moves.
- **After every approve or reject, and when a run finishes,** the backend calls `resolve_ticket_if_done`. Once a ticket's last approval has a human decision (and the Boss has handed it over as `waiting_on_human`), the ticket becomes `resolved` in the database, so `GET /tickets` and the board agree. The run-finish check catches decisions made while the team was still wrapping up. Each resolution is written to the audit trail as `ticket_resolved`.
- `GET /cash` returns the current checking balance from `cash_accounts`, plus the total of placed purchase orders still to be paid and what the balance would be after them.
- `POST /reset` copies `data/campus_customs.db` over `data/campus_customs_new.db`, putting every value back to the original. It's refused while a run is working.
- `GET /health` returns the server status, the model (`gpt-6-luna`), and any active run.

Decisions in this problem:
- **We pay invoices, not purchase orders.** Approving an order places it: the approval becomes `approved`, no `payments` row is written, and cash doesn't move. The vendor's invoice for that order gets paid later through its own approval. That's how invoice 501 works: it's the bill for an earlier "Rush reprint" order. Placed orders still count against cash in `get_cash_position` and `GET /cash`, so committed money doesn't disappear from view.
- **An order can't be placed while that vendor has an open invoice**, because the vendor won't ship. Pay the invoice first.
- **No commitment can push cash negative.** Agents can always *prepare* an order, flagged if cash doesn't cover it. But a human can't approve one unless the account balance, minus orders already placed, covers it.
- **Payments can't eat into committed cash either.** Approving an invoice or rent payment is refused if cash would go negative, or if it would leave less cash than is already committed to placed orders. Together with the order rule, this means cash on hand always covers every placed order. A payment or order the cash can't cover is still queued so the human sees it (with a WARNING); the approval step refuses it. *(Problem 8 follow-up: payments used to be refused at preparation.)*
- **Restock orders for a bulk shortfall (Problem 8 follow-up).** For a price-override / bulk ticket that stock can't fill, the boss has accounting prepare a purchase order for exactly the shortfall, even when cash can't cover it. Example: ticket 103 needs 12 more hoodies, $264.00 at $22.00 each. After the invoice ($840) and rent ($2,400) are paid, checking holds $160.00, so the board shows the warning and approving the order is refused (HTTP 409) because $264.00 > $160.00. The human can still reject it.
- **Store policy: bulk discount (Problem 8 follow-up).** Up to 10% off list on an order of more than 15 units of the same SKU and size. It's defined once in `mcp_server/server.py` (`BULK_MIN_QTY_EXCLUSIVE`, `BULK_DISCOUNT_PCT`) and reported by `get_ticket` and `check_margin` as `bulk_discount_policy`. Only the boss decides to offer it, never above the policy, and passes the decision (%, unit price) to customer service. Accounting reports eligibility and margin; customer service mentions a discount only when the boss gives it.
- **The boss delegates in parallel rounds** (at most two), waiting only for answers a later task needs. Rent: facilities and accounting together. Customer order: inventory and accounting together, then customer service. Bulk order: inventory and accounting together, then the restock order and customer service together. Each task carries the ids and numbers needed, so specialists don't re-ask each other. *(An earlier version delegated one at a time and roughly doubled run time.)*
- **No date commitments to customers.** The boss never commits to a restock or arrival date and passes customer service only what the customer may hear (discount, units available now, "not available yet"). The draft tool enforces it in code. `prepare_payment` / `prepare_purchase_order` write the cash WARNING into the approval's reason themselves.
- **Restart uvicorn after editing `mcp_server/server.py`.** `--reload` only watches `backend/`, and the backend's human-tools connection keeps running the old server code until it restarts. Agent runs start a fresh server each time, so they always get the current code.
- **On Windows, `--reload` runs uvicorn on an event loop that can't start subprocesses**, and the MCP stdio connection needs one. So all MCP and agent work runs on one background thread with its own loop.

## Dashboard (Problem 8)

`frontend/` (React + Vite + TypeScript). Start it from `frontend/` with `npm run dev` and open `http://localhost:5173`. It calls the Problem 7 routes at `http://localhost:8000` (`src/api.ts`), and `backend/main.py` allows that origin with CORS (`http://localhost:5173` and `http://127.0.0.1:5173`; Vite is pinned to 5173). The board has no shop data or money logic of its own: tickets, cash, approvals, and agent events all come from the routes, and Approve/Reject call the human-only approval routes. Design choices are in `output/design.md`.

What's on the board, and which route feeds it:
- **Ticket tray** (`GET /tickets`, `GET /approvals`). Every ticket shows a chip:
  - Open.
  - Team working (royal).
  - **Team done, waiting on human** (yellow): the run finished and a payment or order it prepared still needs a decision.
  - **Resolved** (green): the run finished and every approval has a human decision, or none was needed.
  - Run failed (red).

  The tray also shows the Boss's own status in the database ("Desk status").
- **The floor** (`POST /tickets/{id}/run`, `GET /runs/{id}`, `GET /events`). Five animated agents sit at desks in work outfits. Speech bubbles say what each agent is doing in plain English, with the live tool name, who asked whom for work, and a latest hand-off ribbon. A run timer runs while the team works, and a yellow "Waiting on the AI model" note appears after 20 s with no new step.
- **Needs your signature** (`GET /approvals`, `POST /approvals/{id}/approve|reject`). This sits at the top right of the floor and glows yellow when something is waiting. Each card shows what approving would do to cash, with a warning when cash can't cover it. **Approve is green; Reject is red** and asks for a reason. Refusals from the backend show on the card.
- **Checking balance** (`GET /cash`). Shown top right as slot-machine reels that spin when the balance changes, with a red "−$…" chip after a payment.
- **What the team did** (`GET /events`). The Boss's decision, one card per agent (its answer, actions, and tools), and the saved customer draft. Drafts the tool rejected are left out. The summary carries a green RESOLVED or yellow WAITING ON YOU stamp.
- **Desk log** (`GET /events`). A chat-style feed of every step, colour-coded by agent.
- **Reset shop data** (`POST /reset`). Restores the original database and clears the board's memory of runs.

## Problem 9 run: all three tickets resolved

The database was reset, then the three tickets were run on the board in order, with a human decision after each. The runs are in `output/audit_trail.json`:

| Ticket | Run | Agents | Hand-offs | Human decision | Cash change |
|---|---|---|---|---|---|
| 101 Bulldog tee | `75be36b0c725` (27 s) | Boss, Inventory, Accounting, Customer Service | Boss → Inventory + Accounting together, then Boss → Customer Service | Approved #1, pay invoice 501 | −$840.00 |
| 102 Rent due | `cc2b8d1e2b06` (11 s) | Boss, Facilities, Accounting | Boss → Facilities + Accounting together | Approved #2, pay rent for lease 1 | −$2,400.00 |
| 103 Bulk hoodie discount | `f1b9c9447b5d` (15 s) | Boss, Inventory, Accounting, Customer Service | Boss → Inventory + Accounting, then Boss → Accounting (PO) + Customer Service | Approve #3 ($264 PO) refused (409, $264 > $160), then rejected | $0.00 |

Each ticket was marked `resolved` in the database once its last approval had a human decision. That rule was added right after this run, so it was applied to these three tickets afterward; their `ticket_resolved` audit events carry `applied_after_run: true`.

How the cash reconciles: checking starts at $3,400.00, minus $840.00 for invoice 501, minus $2,400.00 for rent, gives **$160.00**. That matches `cash_accounts` in the working database. The `payments` table has exactly two rows, both approved by the human. No purchase order was placed.

Results are written up in these files:
- `output/desk_tickets.html`: the Actual sections and the Cash tab.
- `output/resolved_tickets.json`: per ticket, the final status, a short outcome, each agent's contribution, and the human approvals.
- `output/resolved_board.html`: board screenshots, saved in `output/screenshots/`.

## Safety

Each guardrail below says where it's enforced. **Code** means it holds even if a model ignores its prompt.

1. **No sensitive supplier or customer identifiers.** Tools select only named columns. The MCP server's `_scrub()` also drops any field whose name looks like bank, routing, IBAN, card, account number, SSN, tax ID, or password, and masks any 12–19 digit run in every tool result. The audit writer applies the same masking and removes the API key. `draft_customer_message` rejects card- or account-length numbers. *(Code + prompt)*
2. **Token and cost limits.** Each ticket has one budget shared across the whole team, including delegations: at most 30 model requests, 40 tool calls, and 100,000 total tokens. Each response is capped at 2,000 output tokens, reasoning effort is set to low, MCP tool calls time out after 30 s, a delegate call (which runs a whole teammate) times out after 180 s, and each tool gets 1 retry. Each model request to Portkey times out after 45 s and is retried up to 2 times, so a stalled provider response can't freeze a run for the client's default 10 minutes; the board shows "Waiting on the AI model" after 20 s without a new step. Delegation is limited to depth 2 and 6 per ticket. If the budget runs out, the ticket stops and is marked `escalated` for a human rather than continuing. For reference, the live smoke test used about 3,500 tokens for one specialist question. *(Code: `backend/config.py`)*
3. **Answers stay on scope.** Prompts tell agents to share only what answers the ticket. `draft_customer_message` refuses drafts that mention internal terms (unit cost, margin, cash balance, bank, profit), the shop's cash balance figure, or (in customer drafts) vendor names, invoices, rent, the landlord, suppliers, purchase orders, approvals, or lead times. Customer drafts are also refused if they contain any calendar date or delivery timeframe ("September 5", "9/5", "within 5 days", "next week"), because the shop never commits to a restock date. *(Code)* It also caps length and only allows recipients on file: the ticket requester, a vendor, or a landlord. *(Code + prompt)*
4. **Tickets can't grant authority.** Authority lives in code, not in text:
   - Each agent's tool allowlist is fixed in its role file.
   - Human-only tools (approve, reject, pay) are filtered out for every agent.
   - No tool exists that edits lead times, prices, balances, or vendor data.
   - Amounts always come from the database.
   - `prepared_by` must be a real agent name.

   `get_ticket` marks the requester, subject, and notes as untrusted and flags phrases like "you now have the authority", "without approval", "ignore previous instructions", or "change the lead time". Prompts tell agents to ignore such text and log it in `guardrail_notes`. *(Code + prompt)*
5. **Human approval for all money.** Agents can only *prepare* payments and POs, which go on the board as `pending`. No agent tool moves cash. A preparation the cash can't cover is still queued for the human but carries a WARNING, and the approval step refuses it, because cash can't go negative and there is no revenue. Duplicate pending requests aren't re-queued. A ticket can't be marked resolved while its approvals are pending. Cash moves only through `POST /approvals/{id}/approve` → `approve_request`, which has three layers of protection:
   - The tool exists only in the backend's `--human-tools` server, so agents and `.mcp.json` can't see it.
   - Agent allowlists also filter it out.
   - It rejects agent names as `approved_by`.

   At pay time, it re-checks the amount in the database and refuses if cash would go negative. *(Code)*
   Discounts are capped by the store's bulk discount policy, reported by the MCP tools; only the boss may offer one, and a ticket can't raise the cap. *(Code + prompt)*
6. **Nothing leaves the shop.** There are no email, phone, or web tools. Customer, vendor, and landlord messages are drafts on the board for a human to send. *(Code)*
7. **Data safety.** Lookups open the database read-only. Writes run in a single transaction that rolls back on any error. The original `campus_customs.db` is never opened by the server. `run_ticket.py --all` resets the working copy before every full run. *(Code)*
8. **One model only.** `MODEL_NAME = "gpt-6-luna"` appears once in `config.py`. Startup aborts if `OPENAI_MODEL` in `.env` names anything else, and every audit entry records the model. *(Code)*
9. **Facts must have sources.** Specialist reports list each fact with the MCP tool that returned it, and put anything the database can't answer under `unknowns` instead of guessing. *(Schema + prompt)*
10. **Failures stay contained.** A tool refusal goes back to the model as a failed result, so the model can adapt without crashing. A teammate's error goes back to the delegating agent rather than sinking the ticket. Every stop reason is written to the audit trail. *(Code)*
11. **Every human decision is on the record.** Approvals keep who decided and when (`approvals.decided_by` / `decided_at`, `payments.approved_by`, `ticket_updates`). The approve and reject routes also write a `human_decision` event to the audit trail, including refused attempts. The board only counts a ticket as resolved once every payment or order it prepared has a human decision. At that point the backend also marks it `resolved` in the database and names that human in the ticket's history. *(Code)*
