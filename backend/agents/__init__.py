"""The Campus Customs agent team: boss, inventory, accounting, facilities, customer_service."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from pydantic_ai import Agent

from agents import accounting, boss, customer_service, facilities, inventory
from models import AgentName, TeamDeps

ROLES = {m.ROLE.name: m.ROLE for m in (boss, inventory, accounting, facilities, customer_service)}


@lru_cache(maxsize=1)
def get_team() -> dict[AgentName, Agent[TeamDeps, Any]]:
    """Build all five agents once. Every one can delegate to every other."""
    return {
        "boss": boss.build(),
        "inventory": inventory.build(),
        "accounting": accounting.build(),
        "facilities": facilities.build(),
        "customer_service": customer_service.build(),
    }
