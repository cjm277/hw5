"""Inventory: stock by SKU and size, shortfalls against the ticket, and which vendor can restock."""

from __future__ import annotations

from agents.base import Role, make_agent
from models import AgentReport

ROLE = Role(
    name="inventory",
    summary="Stock by SKU/size, shortfalls, restock vendors and lead times.",
    mcp_tools=frozenset({"get_ticket", "get_shop_date", "check_stock", "find_restock_vendors"}),
    output_type=AgentReport,
)


def build():
    return make_agent(ROLE)
