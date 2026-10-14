"""Customer service: drafts respectful, tailored, efficient messages with a clear call to action. Never sends."""

from __future__ import annotations

from agents.base import Role, make_agent
from models import AgentReport

ROLE = Role(
    name="customer_service",
    summary="Drafts customer/vendor messages to the board (never sent).",
    mcp_tools=frozenset({"get_ticket", "draft_customer_message", "list_message_drafts"}),
    output_type=AgentReport,
)


def build():
    return make_agent(ROLE)
