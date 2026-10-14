"""FastAPI backend for the Campus Customs dashboard.

Start it from the backend/ folder (with backend/.venv active):

    uvicorn main:app --reload --port 8000

Shop data still flows only through the campus-customs MCP server; this file
has no database code of its own.
- Agent runs use the team's own MCP connection (agents/base.py), which never
  includes the human-only tools.
- Dashboard reads and human decisions use a separate "desk" connection that
  starts the server with --human-tools, so approve_request / reject_request /
  resolve_ticket_if_done exist only there and are reachable only through these routes.
- Once a ticket's last approval has a human decision (or a run finishes with nothing
  left to decide), the ticket is marked resolved in the database.

On Windows, `uvicorn --reload` runs on an event loop that cannot start
subprocesses, and MCP over stdio needs one. So all MCP and agent work runs on
one background thread with its own event loop (the McpWorker below).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastmcp import Client
from fastmcp.client.transports import StdioTransport
from pydantic import BaseModel, Field
from pydantic_core import to_jsonable_python

import audit
import team
from config import MODEL_NAME, ROOT, check_model_env, mcp_command
from reset_db import reset_working_db

check_model_env()  # refuse to start if .env names any model other than gpt-6-luna


# --- background loop for MCP + agents ---------------------------------------

class McpWorker:
    """One thread running its own event loop. Every MCP call and agent run happens here."""

    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self._desk: Client | None = None
        self._desk_lock: asyncio.Lock | None = None

    def start(self) -> None:
        # ProactorEventLoop is the Windows loop that can start subprocesses.
        self.loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, name="mcp-worker", daemon=True).start()

    def submit(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop)

    async def run(self, coro):
        """Run a coroutine on the worker loop and await its result from a request handler."""
        return await asyncio.wrap_future(self.submit(coro))

    async def _desk_client(self) -> Client:
        if self._desk_lock is None:
            self._desk_lock = asyncio.Lock()
        async with self._desk_lock:
            if self._desk is None or not self._desk.is_connected():
                command, args = mcp_command()
                self._desk = Client(StdioTransport(command=command, args=[*args, "--human-tools"], cwd=str(ROOT)))
                await self._desk.__aenter__()
        return self._desk

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        client = await self._desk_client()
        result = await client.call_tool(name, arguments or {}, raise_on_error=False)
        if result.is_error:
            text = " ".join(getattr(c, "text", "") for c in result.content).strip()
            raise ShopToolError(text or f"{name} failed")
        return result.data if result.data is not None else result.structured_content

    async def close(self) -> None:
        if self._desk is not None:
            try:
                await self._desk.__aexit__(None, None, None)
            except Exception:
                pass
            self._desk = None

    def stop(self) -> None:
        if self.loop is None:
            return
        try:
            self.submit(self.close()).result(timeout=10)
        except Exception:
            pass
        self.loop.call_soon_threadsafe(self.loop.stop)


class ShopToolError(Exception):
    """An MCP tool refused or failed; the message is safe to show a human."""


worker = McpWorker()


async def shop(name: str, arguments: dict[str, Any] | None = None) -> Any:
    """Call one campus-customs MCP tool and turn refusals into HTTP errors."""
    try:
        return await worker.run(worker.call_tool(name, arguments))
    except ShopToolError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            code = 404
        elif "agents cannot" in msg.lower():
            code = 403
        else:
            code = 409
        raise HTTPException(status_code=code, detail=msg) from None


# --- agent runs (one at a time: they share the database and the cash) ----------

runs: dict[str, dict[str, Any]] = {}
_run_lock = threading.Lock()
_active_run: str | None = None


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


async def _resolve_if_done(ticket_id: int | None, run_id: str) -> dict[str, Any] | None:
    """Mark the ticket resolved in the database if the team is done and no human decision is still owed.

    Runs on the worker loop. Never raises: a ticket that isn't ready simply stays as it is.
    """
    if ticket_id is None:
        return None
    try:
        result = await worker.call_tool("resolve_ticket_if_done", {"ticket_id": ticket_id})
    except Exception as exc:  # resolving is bookkeeping; it must never break a run or a decision
        print(f"[resolve] ticket {ticket_id}: {exc}")
        return None
    if result.get("resolved"):
        await asyncio.to_thread(
            audit.append, "ticket_resolved", run_id=run_id, ticket_id=ticket_id, agent="human", depth=0, model=None,
            resolved_by=result.get("resolved_by"), message=result.get("note", ""),
        )
    return result


async def _run_job(run_id: str, ticket_id: int) -> None:
    global _active_run
    try:
        outcome = await team.run_ticket(ticket_id, run_id=run_id)
        # A human may have decided everything while the team was still finishing (approvals show up
        # mid-run), so check once more now that the Boss has closed the run.
        await _resolve_if_done(ticket_id, run_id)
        runs[run_id].update(status="finished", outcome=to_jsonable_python(outcome))
    except BaseException as exc:  # includes SystemExit from a missing key; the API must keep serving
        runs[run_id].update(status="failed", error=f"{type(exc).__name__}: {str(exc)[:400]}")
        audit.append("ticket_error", run_id=run_id, ticket_id=ticket_id, agent="team", depth=0,
                     stop_reason=runs[run_id]["error"])
        if isinstance(exc, (KeyboardInterrupt, asyncio.CancelledError)):
            raise
    finally:
        runs[run_id]["finished_at"] = _now()
        with _run_lock:
            _active_run = None


# --- audit events ---------------------------------------------------------------

_BASE_KEYS = ("time", "run_id", "ticket_id", "agent", "depth", "event", "model")


def _read_audit() -> list[dict[str, Any]]:
    with audit._lock:  # the writer replaces the file; don't read halfway through
        if not audit.AUDIT_PATH.exists() or audit.AUDIT_PATH.stat().st_size == 0:
            return []
        rows = json.loads(audit.AUDIT_PATH.read_text(encoding="utf-8"))
    return rows if isinstance(rows, list) else [rows]


def _said_and_tools(e: dict[str, Any]) -> tuple[list[str], list[str]]:
    """What the agent said and which tools it touched in this one event."""
    kind = e.get("event")
    if kind == "model_step":
        return list(e.get("text") or []), [c.get("tool", "") for c in e.get("tool_calls") or []]
    if kind == "tool_results":
        return [], [r.get("tool", "") for r in e.get("results") or []]
    if kind == "agent_end":
        out = e.get("output")
        if isinstance(out, dict):
            said = [out.get(k) for k in ("answer", "decision", "summary_for_human") if out.get(k)]
            return said, []
        return ([str(out)] if out else []), []
    if kind == "delegation":
        return [f"Delegated to {e.get('to_agent')}: {e.get('task', '')}"], ["delegate"]
    if kind == "delegation_refused":
        return [f"Delegation to {e.get('to_agent')} refused: {e.get('reason', '')}"], ["delegate"]
    if kind in ("human_decision", "ticket_resolved"):
        return [str(e.get("message", ""))], []
    if kind in ("agent_stopped", "agent_error", "ticket_error"):
        return [str(e.get("stop_reason", ""))], []
    if kind == "ticket_end":
        out = e.get("outcome") or {}
        return ([out.get("summary_for_human")] if isinstance(out, dict) and out.get("summary_for_human") else []), []
    return [], []


def _event_view(seq: int, e: dict[str, Any]) -> dict[str, Any]:
    said, tools = _said_and_tools(e)
    return {
        "seq": seq,
        **{k: e.get(k) for k in _BASE_KEYS},
        "said": said,
        "tools": [t for t in tools if t],
        "detail": {k: v for k, v in e.items() if k not in _BASE_KEYS},
    }


# --- app ------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    worker.start()
    yield
    worker.stop()


app = FastAPI(
    title="Campus Customs backend",
    description="Routes for the dashboard. Agents only prepare money moves; humans approve them here.",
    lifespan=lifespan,
)
# The React dashboard (frontend/, `npm run dev`) is served by Vite on port 5173 and calls this API
# from the browser, so that page's origin must be allowed. Vite is pinned to 5173 (strictPort).
FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ApproveBody(BaseModel):
    approved_by: str = Field(min_length=2, max_length=60, description="Name of the human approving.")


class RejectBody(BaseModel):
    rejected_by: str = Field(min_length=2, max_length=60, description="Name of the human rejecting.")
    reason: str = Field(min_length=1, max_length=1000)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "model": MODEL_NAME, "active_run": _active_run}


@app.get("/tickets")
async def list_tickets() -> dict[str, Any]:
    """Every ticket with its status, plus a simple open/resolved flag for the board."""
    tickets = await shop("list_tickets")
    for t in tickets:
        t["state"] = "resolved" if t["status"] == "resolved" else "open"
    return {"tickets": tickets}


@app.post("/tickets/{ticket_id}/run", status_code=202)
async def run_ticket(ticket_id: int) -> dict[str, Any]:
    """Start the agent team on one ticket. Returns at once; poll /runs/{run_id} and /events."""
    global _active_run
    tickets = {t["id"]: t for t in await shop("list_tickets")}
    if ticket_id not in tickets:
        raise HTTPException(404, f"Ticket {ticket_id} not found. Tickets on file: {sorted(tickets)}.")
    if tickets[ticket_id]["status"] == "resolved":
        raise HTTPException(409, f"Ticket {ticket_id} is already resolved.")
    if not os.getenv("PORTKEY_API_KEY", "").strip():
        raise HTTPException(503, "PORTKEY_API_KEY is not set in the root .env, so the agents cannot run.")
    with _run_lock:
        if _active_run is not None:
            raise HTTPException(409, f"Busy with {_active_run}; wait for it to finish.")
        run_id = uuid.uuid4().hex[:12]
        _active_run = run_id
    runs[run_id] = {"run_id": run_id, "ticket_id": ticket_id, "status": "running", "started_at": _now()}
    worker.submit(_run_job(run_id, ticket_id))
    return {**runs[run_id], "poll": f"/runs/{run_id}", "events": f"/events?run_id={run_id}"}


@app.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    """Status of one agent run (running, finished, failed) and the boss's outcome when done."""
    if run_id not in runs:
        raise HTTPException(404, f"Run {run_id} not found since this server started.")
    return runs[run_id]


@app.get("/events")
async def recent_events(
    limit: int = Query(50, ge=1, le=500),
    ticket_id: int | None = None,
    run_id: str | None = None,
    after: int | None = Query(None, ge=-1, description="Only events with seq greater than this (for polling)."),
) -> dict[str, Any]:
    """Newest agent events from output/audit_trail.json: who spoke, what they said, which tools they used."""
    rows = await run_in_threadpool(_read_audit)
    picked = [
        (seq, e) for seq, e in enumerate(rows)
        if (ticket_id is None or e.get("ticket_id") == ticket_id)
        and (run_id is None or e.get("run_id") == run_id)
        and (after is None or seq > after)
    ][-limit:]
    return {"events": [_event_view(seq, e) for seq, e in picked], "last_seq": len(rows) - 1}


@app.get("/approvals")
async def pending_approvals(ticket_id: int | None = None) -> dict[str, Any]:
    """Payments and purchase orders the agents prepared that are waiting for a human."""
    return {"approvals": await shop("list_pending_approvals", {"ticket_id": ticket_id})}


def _latest_run_for(ticket_id: int | None) -> str:
    """The most recent run started on this ticket since the server started, or 'desk'."""
    mine = [r for r in runs.values() if r["ticket_id"] == ticket_id]
    return max(mine, key=lambda r: r["started_at"])["run_id"] if mine else "desk"


async def _audit_decision(decision: str, approval: dict[str, Any] | None, approval_id: int, human: str,
                          message: str, **extra: Any) -> None:
    """Append a human approve / reject / refused attempt to the audit trail next to the agents' steps."""
    ticket_id = approval.get("ticket_id") if approval else None
    await run_in_threadpool(
        audit.append, "human_decision", run_id=_latest_run_for(ticket_id), ticket_id=ticket_id, agent="human",
        depth=0, model=None, decision=decision, approval_id=approval_id,
        kind=approval.get("kind") if approval else None, amount=approval.get("amount") if approval else None,
        decided_by=human, message=message, **extra,
    )


async def _pending(approval_id: int) -> dict[str, Any] | None:
    return next((a for a in await shop("list_pending_approvals") if a["id"] == approval_id), None)


@app.post("/approvals/{approval_id}/approve")
async def approve(approval_id: int, body: ApproveBody) -> dict[str, Any]:
    """HUMAN ONLY: pay an invoice or rent (the only path that lowers cash), or place a purchase order (no cash moves)."""
    try:
        result = await shop("approve_request", {"approval_id": approval_id, "approved_by": body.approved_by})
    except HTTPException as exc:
        await _audit_decision("approve_refused", await _pending(approval_id), approval_id, body.approved_by,
                              str(exc.detail), http_status=exc.status_code)
        raise
    await _audit_decision("approved", result.get("approval"), approval_id, body.approved_by, result.get("message", ""),
                          balance_after=result.get("balance_after"))
    ticket_id = (result.get("approval") or {}).get("ticket_id")
    result["ticket"] = await worker.run(_resolve_if_done(ticket_id, _latest_run_for(ticket_id)))
    return result


@app.post("/approvals/{approval_id}/reject")
async def reject(approval_id: int, body: RejectBody) -> dict[str, Any]:
    """HUMAN ONLY: reject one request. No money moves."""
    result = await shop("reject_request", {"approval_id": approval_id, "rejected_by": body.rejected_by,
                                           "reason": body.reason})
    await _audit_decision("rejected", result.get("approval"), approval_id, body.rejected_by, result.get("message", ""),
                          reason=body.reason)
    ticket_id = (result.get("approval") or {}).get("ticket_id")
    result["ticket"] = await worker.run(_resolve_if_done(ticket_id, _latest_run_for(ticket_id)))
    return result


@app.get("/cash")
async def checking_balance() -> dict[str, Any]:
    """Current checking balance from cash_accounts, plus placed orders that will still need paying."""
    position = await shop("get_cash_position")
    for acct in position["cash_accounts"]:
        if acct["name"] == "checking":
            committed = sum(c["amount"] for c in position["committed_purchase_orders"] if c["account"] == "checking")
            return {"account": "checking", "balance": acct["balance"], "as_of": acct["as_of"],
                    "committed_purchase_orders": round(committed, 2),
                    "balance_after_committed_orders": round(acct["balance"] - committed, 2)}
    raise HTTPException(404, "No 'checking' row in cash_accounts.")


@app.post("/reset")
async def reset() -> dict[str, Any]:
    """Copy data/campus_customs.db over data/campus_customs_new.db (clears approvals, drafts, payments)."""
    global _active_run
    with _run_lock:
        if _active_run is not None:
            raise HTTPException(409, f"Busy with {_active_run}; reset after it finishes.")
        _active_run = "reset"
    try:
        await run_in_threadpool(reset_working_db)
    except SystemExit as exc:
        raise HTTPException(500, str(exc)) from None
    finally:
        with _run_lock:
            _active_run = None
    return {"reset": True, "message": "Working database restored from the original.",
            "checking": await checking_balance()}
