# Campus Customs: Multi-Agent Back Office (MGT 409, Homework 5)

A five-agent team (Boss, Inventory, Accounting, Facilities, Customer Service) works the Campus Customs shop tickets. All shop data flows through one MCP server. A FastAPI backend runs the agents, and a React board lets a human watch the team and approve or reject every payment and purchase order. Every agent uses **gpt-6-luna through Portkey**. No money moves without a human.

- Repository: see `output/github_url.txt`
- Full documentation (tables, MCP tools, agents, routes, dashboard, safety rules, and the graded run): [`output/harness.md`](output/harness.md)
- Results of the graded run: [`output/desk_tickets.html`](output/desk_tickets.html) (Expected / Actual / Cash / Reflection), [`output/resolved_tickets.json`](output/resolved_tickets.json), [`output/resolved_board.html`](output/resolved_board.html)

## What's in the repo

| Path | What it is |
|---|---|
| `data/campus_customs.db` | The **original** database. Never modified; it's the clean reset point. |
| `data/campus_customs_new.db` | The **working copy** every tool reads and writes. It is committed in its state after the graded run: all three tickets resolved, checking at $160.00. |
| `mcp_server/server.py` | The FastMCP server: the only path from agents to shop data (19 tools; see `mcp_server/README.md`). |
| `mcp_server/run_server.py` | Portable launcher used by `.mcp.json` and the backend. It creates `mcp_server/.venv` on first run. |
| `backend/main.py` | FastAPI routes for the board. |
| `backend/models.py`, `backend/agents/`, `backend/prompts/` | Data types, the five PydanticAI agents, and one prompt per agent (plus `shared_rules.md`). |
| `backend/config.py` | The one model setting (`gpt-6-luna`), Portkey connection, and spending limits. |
| `frontend/` | The React + Vite + TypeScript board. |
| `output/` | Harness, smoke test, design notes, desk tickets, resolved tickets, board screenshots, audit trail, and the repo URL. |
| `AI_prompts.md` | Every prompt I gave the vibe coder, problem by problem. |

## Prerequisites

- Python 3.11 or newer (built and run on 3.14).
- Node.js 20.19+ or 22.12+ (built on Node 24), with npm.
- A Portkey API key with access to `gpt-6-luna`. You only need it to run the agents; the board, the database, and the approval routes work without it.

## Setup (once)

From the project root (the folder that contains this README):

```bash
# 1. Secrets: copy the example and put your Portkey key in it. .env is git-ignored.
cp .env.example .env

# 2. Python environment for the backend
python -m venv backend/.venv
backend\.venv\Scripts\activate          # Windows (PowerShell: backend\.venv\Scripts\Activate.ps1)
source backend/.venv/bin/activate      # macOS / Linux
pip install -r requirements.txt

# 3. Board dependencies
cd frontend
npm install
cd ..
```

## 1. Copy the original database to the working copy (clean run)

The working copy in the repo already holds the graded run's results. When you want a clean run, copy the original over it. Every approval, draft, payment, and ticket status goes back to the starting point ($3,400.00 in checking, tickets 101–103 open).

```bash
python backend/reset_db.py                                   # with backend/.venv active; checks the copy is identical
```

Without the venv, a plain copy does the same thing:

```bash
cp data/campus_customs.db data/campus_customs_new.db                       # macOS / Linux / Git Bash
Copy-Item data\campus_customs.db data\campus_customs_new.db -Force          # Windows PowerShell
```

You can also reset from the running app with **Reset shop data** on the board, or with `POST http://localhost:8000/reset`.

## 2. Start the MCP server

The backend starts the MCP server itself, over stdio, for every agent run and for the board's approval actions. So you don't need a separate window for the app. Run it once by hand first so its environment gets created; the first install takes about 30 seconds:

```bash
python mcp_server/run_server.py --help
```

Other ways to start it:
- **Vibe coder / MCP client:** `.mcp.json` in the project root starts it with `python mcp_server/run_server.py`.
- **Standalone over HTTP** (for inspecting the tools): `python mcp_server/run_server.py --http`, which serves `http://127.0.0.1:8001/mcp`.

## 3. Start the FastAPI backend

```bash
cd backend
uvicorn main:app --reload --port 8000          # with backend/.venv active
```

Check it's up: `http://localhost:8000/health` should return `{"status": "ok", "model": "gpt-6-luna", ...}`. The routes are listed in `output/harness.md` and in the live docs at `http://localhost:8000/docs`.

## 4. Start the React board

In a second terminal:

```bash
cd frontend
npm run dev
```

Then open **http://localhost:5173**. The board talks to the backend at `http://localhost:8000`, and the backend only allows this origin (CORS). Vite is pinned to port 5173.

## 5. A full three-ticket run

**Reset the database before a full three-ticket run** (step 1, or **Reset shop data** on the board). Then, on the board:

1. Type your name in **Signing as** (top right of the agent floor).
2. Select **#101**, then **Send to the agent team**. When the team is done, approve the invoice 501 payment ($840.00). Checking drops to $2,560.00.
3. Select **#102** and send it. Approve the rent payment ($2,400.00). Checking drops to $160.00.
4. Select **#103** and send it. The team offers the 10% bulk discount and prepares a $264.00 restock order with a cash warning. Approving it is refused, because $264.00 is more than the $160.00 on hand. Reject it, and the ticket turns green.

The order matters for ticket 103: the cash refusal appears only after the invoice and rent are paid. A ticket shows **Team done, waiting on human** (yellow) while a payment or order needs your decision. It turns **Resolved** (green), and is marked resolved in the database, once you've made the last decision.

There's also a command-line runner (no board): `python backend/run_ticket.py --all` resets the database, then works every open ticket. It can't approve anything; approvals only happen on the board.

## Where results go

- `output/audit_trail.json` is append-only. It holds every agent step (model calls, tool calls, hand-offs) and every human approve, reject, refusal, and ticket resolution.
- The board reads it through `GET /events`.
- After a run, see `output/harness.md` ("Problem 9 run") and `output/desk_tickets.html` for how the graded run was documented.

## Safety in one paragraph

- **Shop data comes only from the MCP server.**
- **Money:** agents can only *prepare* payments and purchase orders. Only a human, on the board, can approve them, and the approve step refuses anything that would push cash negative.
- **Customer drafts:** never sent. The draft tool rejects internal figures, supplier and purchase-order details, and any date commitment.
- **Untrusted tickets:** ticket text is treated as untrusted, and phrases that try to grant authority are flagged.
- **Limits:** each ticket has a shared token and tool budget.
- **One model:** `gpt-6-luna` is the only model; the backend refuses any other.

The full list, with where each rule is enforced, is in the Safety section of `output/harness.md`.
