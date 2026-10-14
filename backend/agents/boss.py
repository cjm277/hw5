"""Boss: reads each ticket, routes work to the right specialist, makes the final call, closes the loop."""

from __future__ import annotations

from pydantic_ai import ModelRetry, RunContext

from agents.base import Role, make_agent
from models import TeamDeps, TicketOutcome

ROLE = Role(
    name="boss",
    summary="Reads tickets, routes work, makes final decisions, sets ticket status.",
    mcp_tools=frozenset({
        "list_open_tickets", "get_ticket", "get_shop_date",
        "list_pending_approvals", "list_message_drafts", "update_ticket_status",
    }),
    output_type=TicketOutcome,
)


def build():
    agent = make_agent(ROLE)

    @agent.output_validator
    def consistent_outcome(ctx: RunContext[TeamDeps], out: TicketOutcome) -> TicketOutcome:
        """Code-level checks the boss's final answer must pass before it is accepted."""
        if ctx.deps.ticket_id is not None and out.ticket_id != ctx.deps.ticket_id:
            raise ModelRetry(f"ticket_id must be {ctx.deps.ticket_id}.")
        if out.approval_ids and out.final_status == "resolved":
            raise ModelRetry("Pending approvals need a human: final_status must be 'waiting_on_human', not 'resolved'.")
        return out

    return agent
