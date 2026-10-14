"""Facilities: the shop space — leases, rent amount and timing, compliance with lease terms."""

from __future__ import annotations

from agents.base import Role, make_agent
from models import AgentReport

ROLE = Role(
    name="facilities",
    summary="Leases, rent amount and due dates, timing and lease compliance.",
    mcp_tools=frozenset({"get_ticket", "get_shop_date", "get_rent_status", "list_pending_approvals"}),
    output_type=AgentReport,
)


def build():
    return make_agent(ROLE)
