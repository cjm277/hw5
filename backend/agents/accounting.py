"""Accounting: cash, invoices, margins; prepares payments and purchase orders for HUMAN approval only."""

from __future__ import annotations

from agents.base import Role, make_agent
from models import AgentReport

ROLE = Role(
    name="accounting",
    summary="Cash, invoices, margins; prepares payments/POs for human approval (cannot approve).",
    mcp_tools=frozenset({
        "get_ticket", "get_shop_date", "get_cash_position", "get_invoice_status", "check_margin",
        "prepare_payment", "prepare_purchase_order", "list_pending_approvals",
    }),
    output_type=AgentReport,
)


def build():
    return make_agent(ROLE)
