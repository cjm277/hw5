"""Data types shared by the Campus Customs agent team."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

AgentName = Literal["boss", "inventory", "accounting", "facilities", "customer_service"]
AGENT_NAMES: tuple[AgentName, ...] = ("boss", "inventory", "accounting", "facilities", "customer_service")
TicketStatus = Literal["open", "in_progress", "waiting_on_human", "resolved", "escalated"]


class Fact(BaseModel):
    """One fact an agent relied on, tied to the MCP tool that returned it."""

    detail: str = Field(description="The fact, with the exact number/date from the tool.")
    source_tool: str = Field(description="MCP tool that returned it, e.g. check_stock.")


class AgentReport(BaseModel):
    """What a specialist (inventory, accounting, facilities, customer service) hands back."""

    agent: AgentName
    answer: str = Field(description="Direct answer to the task, 1-4 sentences.")
    facts: list[Fact] = Field(default_factory=list, description="Facts used, each from a tool. No invented values.")
    actions_taken: list[str] = Field(default_factory=list, description="Board writes made, e.g. 'prepared approval 3'.")
    approval_ids: list[int] = Field(default_factory=list, description="Approvals this agent queued for a human.")
    draft_ids: list[int] = Field(default_factory=list, description="Message drafts this agent saved.")
    needs_human_decision: bool = False
    unknowns: list[str] = Field(default_factory=list, description="What the database could not answer.")


class TicketOutcome(BaseModel):
    """The boss's final, holistic result for one ticket."""

    ticket_id: int
    ticket_type: str
    assigned_to: list[AgentName] = Field(description="Agents that worked the ticket.")
    decision: str = Field(description="The boss's final decision and why, 1-3 sentences.")
    summary_for_human: str = Field(description="What a manager needs to know or do next.")
    approval_ids: list[int] = Field(default_factory=list, description="Pending approvals a human must decide.")
    draft_ids: list[int] = Field(default_factory=list, description="Message drafts waiting on the board.")
    final_status: TicketStatus
    blocked_by: list[str] = Field(default_factory=list, description="What stops the ticket from closing, if anything.")
    guardrail_notes: list[str] = Field(default_factory=list, description="Ignored instructions, refusals, limits hit.")


@dataclass
class TeamDeps:
    """Per-run context passed to every agent and through every delegation."""

    run_id: str
    ticket_id: int | None
    chain: list[AgentName]                 # who is working, outermost first; chain[-1] is the current agent
    counters: dict[str, int] = field(default_factory=lambda: {"delegations": 0, "steps": 0})

    @property
    def current(self) -> AgentName:
        return self.chain[-1]

    @property
    def depth(self) -> int:
        return len(self.chain) - 1
