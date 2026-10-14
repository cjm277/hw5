# Campus Customs MCP Server

A FastMCP server that gives every Campus Customs agent (boss, inventory, accounting, facilities, customer service) one shared set of shop tools. It is the **only** way agents reach shop data: the backend has no database code of its own. Tools return only what is in the database. If a SKU, ticket, invoice, lease, or vendor doesn't exist, the tool returns an error listing the valid values.

## Database

The server uses `data/campus_customs_new.db`, the working copy. The original `data/campus_customs.db` is never opened, so it stays clean for resets (`python backend/reset_db.py`).

Lookups open the database read-only. The few write tools add rows to three board tables, which are created in the working copy on first write and cleared by a reset:
- `approvals`: payments and purchase orders waiting for a human
- `message_drafts`: drafts, never sent
- `ticket_updates`: ticket status history

No agent tool changes vendors, pricing, inventory counts, leases, or cash balances. The human-only tools below are the only ones that move money or close a ticket for a human. They're registered only when the server is started with `--human-tools`, which only the FastAPI backend (`backend/main.py`) does. Agents and `.mcp.json` never see them.

## Tools

| Tool | Reads (→ writes) | What it does |
|---|---|---|
| `get_shop_date()` | `desk` | The shop's "today" (`desk.date_today`) |
| `list_open_tickets()` | `tickets` | Every non-resolved ticket |
| `list_tickets()` | `tickets` | Every ticket, including resolved ones, with status (for the dashboard) |
| `get_ticket(ticket_id)` | `tickets`, `ticket_updates` | Full ticket, linked ids, history, prompt-injection flags on untrusted text, and the bulk discount policy for the ticket's qty |
| `update_ticket_status(ticket_id, status, note, updated_by)` | `tickets` → `ticket_updates` | Sets status and logs a note. Refuses `resolved` while approvals are pending. |
| `check_stock(sku, size, qty_needed=None)` | `inventory` | On hand, location, shortfall, can-fill |
| `find_restock_vendors(sku)` | `inventory`, `vendors`, `invoices`, `desk` | Each vendor's specialty, lead_days, open invoices, will_ship, arrival dates, and past invoices for the SKU |
| `get_invoice_status(invoice_id)` | `invoices`, `vendors`, `desk` | Amount, due date, days overdue, vendor will ship, lead time |
| `check_margin(sku, qty=1, proposed_unit_price=None, discount_pct=None)` | `pricing` | Margin at list and at a proposal, break-even discount, below-cost flag, and the store's bulk discount policy (up to 10% off on more than 15 of one SKU and size; only the boss decides) |
| `get_cash_position()` | `cash_accounts`, `invoices`, `vendors`, `leases`, `desk`, `approvals` | Cash vs. open invoices, rent due in 30 days, and pending approvals |
| `prepare_payment(kind, ref_id, reason, prepared_by, ticket_id=None, account="checking")` | `invoices`/`leases`, `cash_accounts` → `approvals` | Queues an invoice or rent payment as **pending human approval**. The amount comes from the database. If it's more than the cash on hand it's still queued with a warning, and approval is refused. |
| `prepare_purchase_order(vendor_id, sku, size, qty, reason, prepared_by, ticket_id=None, account="checking")` | `vendors`, `inventory`, `pricing`, `invoices`, `cash_accounts` → `approvals` | Queues a restock PO as **pending human approval**. Cost = unit_cost × qty. Flags a vendor blocked by an open invoice, and flags an order bigger than the uncommitted cash. That kind of order is still queued, but a human can't approve it until cash covers it. |
| `list_pending_approvals(ticket_id=None)` | `approvals` | What is waiting for a human |
| `get_rent_status(lease_id)` | `leases`, `desk`, `cash_accounts` | Rent, due date, days until due, cash coverage |
| `draft_customer_message(ticket_id, recipient, subject, body, drafted_by)` | `tickets`, `vendors`, `leases` → `message_drafts` | Saves a draft (never sent). Rejects internal financials, sensitive numbers, unknown recipients, and, in customer drafts, vendor/supplier/purchase-order/approval/lead-time/invoice/rent details or any date or delivery timeframe. |
| `list_message_drafts(ticket_id=None)` | `message_drafts` | Drafts waiting for human review |
| `approve_request(approval_id, approved_by)` **human only** | `approvals`, `invoices`/`leases`/`pricing`, `cash_accounts` → `payments`, `cash_accounts`, `invoices`/`leases`, `approvals`, `ticket_updates` | Invoice or rent: pays in one transaction. It refuses if cash would go negative or would drop below what's committed to placed orders. Purchase order: places the order with status `approved` and moves no cash, because the vendor's invoice is paid later. It refuses if the order plus orders already placed would be more than the balance, or if the vendor has an open invoice (listing every reason, cash first). Agent names and changed amounts are always refused. |
| `reject_request(approval_id, rejected_by, reason)` **human only** | `approvals` → `approvals`, `ticket_updates` | Rejects a request. No money moves. |
| `resolve_ticket_if_done(ticket_id)` **human side only** | `tickets`, `approvals` → `tickets`, `ticket_updates` | Marks the ticket `resolved` once the Boss has handed it over (`waiting_on_human`) and none of its approvals is still pending. The backend calls it after each human decision and when a run finishes. |

All results pass through `_scrub()`, which removes bank, card, or account-type fields and masks 12–19 digit numbers.

## Setup and run

The project-root `.mcp.json` starts the server with relative paths, so it works from any clone:

```json
"command": "python", "args": ["mcp_server/run_server.py"]
```

`run_server.py` uses only the standard library. It finds `mcp_server/.venv` (Windows or macOS/Linux layout), creates it and installs `requirements.txt` if it's missing, then runs `server.py`. The backend starts the server the same way.

**Run this once from the project root before opening the vibe coder.** The first install takes about 30 seconds, which can hit the MCP startup timeout:

```bash
python mcp_server/run_server.py --help
```

After that it starts in a few seconds. To run it directly:

```bash
python mcp_server/run_server.py          # stdio
python mcp_server/run_server.py --http   # http://127.0.0.1:8001/mcp
python mcp_server/run_server.py --human-tools   # adds approve/reject (the backend does this; don't use for agents)
```

On macOS, if only `python3` is on your PATH, use `python3` in these commands and in `.mcp.json`.
