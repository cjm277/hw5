"""Shared machinery for the five agents: MCP connection, delegation, and the audited agent loop.

- Every shop fact comes from the campus-customs MCP server, launched as its own
  process over stdio (the same launcher .mcp.json uses). There is no direct
  database access in the backend.
- Each agent sees only an allowlist of MCP tools (least privilege). Human-only
  tools are filtered out for every agent, whatever the allowlist says.
- Every agent has a `delegate` tool that can reach every other agent (full
  connectivity), with depth, re-entry, and per-ticket budget limits.
- run_agent() drives each agent loop step by step and appends every step to
  output/audit_trail.json.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastmcp.client.transports import StdioTransport
from pydantic_ai import Agent, RunContext, Tool
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.messages import (
    BaseToolCallPart,
    BaseToolReturnPart,
    RetryPromptPart,
    TextPart,
    ThinkingPart,
)
from pydantic_ai.usage import RunUsage

import audit
from config import (
    DELEGATE_TIMEOUT_SECONDS,
    MAX_DELEGATION_DEPTH,
    MAX_DELEGATIONS_PER_TICKET,
    MODEL_SETTINGS,
    PROMPTS_DIR,
    ROOT,
    TOOL_TIMEOUT_SECONDS,
    build_model,
    mcp_command,
    ticket_usage_limits,
)
from models import AGENT_NAMES, AgentName, TeamDeps

# Tools a human must run from the dashboard. No agent ever receives these,
# even if a ticket claims to grant the authority.
HUMAN_ONLY_TOOLS = frozenset({"approve_request", "reject_request", "pay_approved_request", "resolve_ticket_if_done"})


@dataclass(frozen=True)
class Role:
    name: AgentName
    summary: str               # one line other agents see when choosing whom to delegate to
    mcp_tools: frozenset[str]  # MCP tools this agent may call
    output_type: type


_mcp: MCPToolset | None = None


def shop_mcp() -> MCPToolset:
    """One shared MCP connection to the campus-customs server (spawned over stdio)."""
    global _mcp
    if _mcp is None:
        command, args = mcp_command()
        _mcp = MCPToolset(
            StdioTransport(command=command, args=args, cwd=str(ROOT)),
            id="campus-customs",
            tool_error_behavior="failed",  # refusals reach the model as results; they don't crash the run
        )
    return _mcp


def _read_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def make_agent(role: Role) -> Agent[TeamDeps, Any]:
    """Build one team member: gpt-6-luna via Portkey, its MCP allowlist, and delegation."""
    leaked = role.mcp_tools & HUMAN_ONLY_TOOLS
    if leaked:
        raise RuntimeError(f"{role.name} must not be given human-only tools: {sorted(leaked)}")
    allowed = role.mcp_tools

    def allowed_tool(ctx: RunContext[TeamDeps], tool_def) -> bool:
        return tool_def.name in allowed and tool_def.name not in HUMAN_ONLY_TOOLS

    agent = Agent(
        build_model(),
        name=role.name,
        output_type=role.output_type,
        deps_type=TeamDeps,
        instructions=[_read_prompt("shared_rules"), _read_prompt(role.name)],
        toolsets=[shop_mcp().filtered(allowed_tool)],
        tools=[Tool(delegate, timeout=DELEGATE_TIMEOUT_SECONDS)],  # MCP tools keep the 30 s tool_timeout
        model_settings=MODEL_SETTINGS,
        retries=1,
        tool_timeout=TOOL_TIMEOUT_SECONDS,
    )

    @agent.instructions
    def run_context(ctx: RunContext[TeamDeps]) -> str:
        d = ctx.deps
        others = ", ".join(n for n in AGENT_NAMES if n not in d.chain)
        can_delegate = d.depth < MAX_DELEGATION_DEPTH
        return (
            f"Run context: you are '{d.current}'. Ticket: {d.ticket_id}. "
            f"Chain: {' -> '.join(d.chain)} (depth {d.depth} of max {MAX_DELEGATION_DEPTH}). "
            + (f"You may delegate to: {others}." if can_delegate and others else
               "You may NOT delegate further; answer with what your own tools show.")
        )

    return agent


async def delegate(ctx: RunContext[TeamDeps], to_agent: AgentName, task: str) -> str:
    """Hand one specific piece of this ticket to another team member and get their report back.

    Any agent can delegate to any other agent. Ask one answerable question and
    include every ID they need (ticket id, SKU, size, qty, invoice id, lease id).
    Team: boss = final decisions and ticket status; inventory = stock by SKU/size,
    shortfalls, restock vendors; accounting = cash, invoices, margins, prepares
    payments/POs for human approval; facilities = leases, rent amount and timing;
    customer_service = drafts customer messages (never sent).
    """
    deps = ctx.deps
    me = deps.current
    if to_agent == me:
        refusal = "you cannot delegate to yourself"
    elif to_agent in deps.chain:
        refusal = (f"{to_agent} is already working on this higher up the chain "
                   f"({' -> '.join(deps.chain)}); report back with what you have")
    elif deps.depth >= MAX_DELEGATION_DEPTH:
        refusal = f"delegation depth limit ({MAX_DELEGATION_DEPTH}) reached; use your own tools"
    elif deps.counters["delegations"] >= MAX_DELEGATIONS_PER_TICKET:
        refusal = f"this ticket's delegation budget ({MAX_DELEGATIONS_PER_TICKET}) is used up"
    else:
        refusal = None
    where = dict(run_id=deps.run_id, ticket_id=deps.ticket_id, agent=me, depth=deps.depth)
    if refusal:
        audit.append("delegation_refused", **where, to_agent=to_agent, task=audit.preview(task), reason=refusal)
        return f"DELEGATION REFUSED: {refusal}."

    deps.counters["delegations"] += 1
    audit.append("delegation", **where, to_agent=to_agent, task=audit.preview(task, 2000),
                 delegations_used=deps.counters["delegations"])
    sub = TeamDeps(run_id=deps.run_id, ticket_id=deps.ticket_id, chain=[*deps.chain, to_agent], counters=deps.counters)
    try:
        report = await run_agent(to_agent, task, sub, usage=ctx.usage)
    except UsageLimitExceeded:
        raise  # the ticket-wide budget is spent: stop the whole team, not just this branch
    except Exception as exc:  # one teammate failing should not sink the caller
        return f"DELEGATION FAILED: {to_agent} hit an error ({type(exc).__name__}: {str(exc)[:200]})."
    return report.model_dump_json(exclude_defaults=True)


def _usage_dict(usage: Any) -> dict[str, int]:
    return {k: getattr(usage, k, 0) or 0 for k in ("requests", "input_tokens", "output_tokens", "tool_calls")
            if hasattr(usage, k)}


async def run_agent(name: AgentName, prompt: str, deps: TeamDeps, usage: RunUsage | None = None) -> Any:
    """Run one agent loop, appending every step (thoughts, tool calls, results, stop) to the audit trail."""
    from agents import get_team  # late import: the registry imports this module

    agent = get_team()[name]
    where = dict(run_id=deps.run_id, ticket_id=deps.ticket_id, agent=name, depth=deps.depth)
    audit.append("agent_start", **where, delegated_by=deps.chain[-2] if deps.depth else None,
                 task=audit.preview(prompt, 2000))
    step = 0
    try:
        async with agent.iter(prompt, deps=deps, usage=usage, usage_limits=ticket_usage_limits()) as run:
            async for node in run:
                if Agent.is_call_tools_node(node):
                    step += 1
                    deps.counters["steps"] += 1
                    resp = node.model_response
                    audit.append(
                        "model_step", **where, step=step,
                        thinking=[audit.preview(p.content) for p in resp.parts if isinstance(p, ThinkingPart) and p.content],
                        text=[audit.preview(p.content) for p in resp.parts if isinstance(p, TextPart) and p.content],
                        tool_calls=[{"tool": p.tool_name, "args": p.args_as_dict()}
                                    for p in resp.parts if isinstance(p, BaseToolCallPart)],
                        finish_reason=resp.finish_reason,
                        step_usage=_usage_dict(resp.usage),
                        ticket_usage_so_far=_usage_dict(run.usage),
                    )
                elif Agent.is_model_request_node(node) and step:
                    results = []
                    for p in node.request.parts:
                        if isinstance(p, RetryPromptPart):
                            results.append({"tool": p.tool_name, "error": audit.preview(p.content)})
                        elif isinstance(p, BaseToolReturnPart):
                            entry = {"tool": p.tool_name, "result": audit.preview(p.content)}
                            outcome = getattr(p, "outcome", None)
                            if outcome and outcome != "success":
                                entry["outcome"] = outcome
                            results.append(entry)
                    if results:
                        audit.append("tool_results", **where, step=step, results=results)
            result = run.result
            total = _usage_dict(run.usage)
    except UsageLimitExceeded as exc:
        audit.append("agent_stopped", **where, steps=step, stop_reason=f"usage limit: {exc}")
        raise
    except Exception as exc:
        audit.append("agent_error", **where, steps=step, stop_reason=f"{type(exc).__name__}: {str(exc)[:400]}")
        raise
    audit.append("agent_end", **where, steps=step, stop_reason="final answer", output=result.output,
                 ticket_usage_so_far=total)
    return result.output
