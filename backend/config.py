"""Shared configuration: the one model, Portkey connection, paths, and spending limits.

MODEL_NAME is the only model string in this project. Every agent imports it
from here; no agent names a model itself, and there is no fallback model.
"""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

from dotenv import load_dotenv  # noqa: E402
from openai import AsyncOpenAI  # noqa: E402
from pydantic_ai.models.openai import OpenAIResponsesModel, OpenAIResponsesModelSettings  # noqa: E402
from pydantic_ai.providers.openai import OpenAIProvider  # noqa: E402
from pydantic_ai.usage import UsageLimits  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent
ROOT = BACKEND_DIR.parent
PROMPTS_DIR = BACKEND_DIR / "prompts"
AUDIT_PATH = ROOT / "output" / "audit_trail.json"
MCP_LAUNCHER = ROOT / "mcp_server" / "run_server.py"
ORIGINAL_DB = ROOT / "data" / "campus_customs.db"
WORKING_DB = ROOT / "data" / "campus_customs_new.db"

# Homework root .env first, then the course-root .env (where PORTKEY_API_KEY lives).
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent.parent / ".env")

MODEL_NAME = "gpt-6-luna"  # required by the assignment for every agent
PORTKEY_BASE_URL = "https://api.portkey.ai/v1"

# --- spending limits (shared by the whole team on one ticket) ----------------
MAX_MODEL_REQUESTS_PER_TICKET = 30   # all agents' model calls combined
MAX_TOOL_CALLS_PER_TICKET = 40       # all MCP + delegate calls combined
MAX_TOTAL_TOKENS_PER_TICKET = 100_000
MAX_OUTPUT_TOKENS_PER_RESPONSE = 2_000
MAX_DELEGATION_DEPTH = 2             # boss -> specialist -> specialist, no deeper
MAX_DELEGATIONS_PER_TICKET = 6
TOOL_TIMEOUT_SECONDS = 30           # each MCP tool call
DELEGATE_TIMEOUT_SECONDS = 180      # a delegate call runs a whole teammate (which may delegate again)
# One model request normally answers in 2-10 s. If Portkey stalls, give up on that request after
# this long and retry, instead of the OpenAI client's default 10-minute wait.
MODEL_REQUEST_TIMEOUT_SECONDS = 45
MODEL_MAX_RETRIES = 2
AUDIT_PREVIEW_CHARS = 600


def check_model_env() -> None:
    """Fail fast if .env asks for any model other than the required one."""
    configured = os.getenv("OPENAI_MODEL", "").strip()
    if configured and configured != MODEL_NAME:
        raise SystemExit(
            f"OPENAI_MODEL in .env is '{configured}', but this homework must use '{MODEL_NAME}'. "
            "Fix .env; no other model is allowed."
        )


@lru_cache(maxsize=1)
def build_model() -> OpenAIResponsesModel:
    """The single gpt-6-luna model object, routed through Portkey, shared by all agents."""
    check_model_env()
    api_key = os.getenv("PORTKEY_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("PORTKEY_API_KEY is not set. Add it to the root .env file (it is never printed).")
    client = AsyncOpenAI(
        timeout=MODEL_REQUEST_TIMEOUT_SECONDS,
        max_retries=MODEL_MAX_RETRIES,
        api_key=api_key,
        base_url=PORTKEY_BASE_URL,
        default_headers={"x-portkey-api-key": api_key},
    )
    return OpenAIResponsesModel(MODEL_NAME, provider=OpenAIProvider(openai_client=client))


MODEL_SETTINGS = OpenAIResponsesModelSettings(
    max_tokens=MAX_OUTPUT_TOKENS_PER_RESPONSE,
    openai_reasoning_effort="low",
    openai_reasoning_summary="auto",
)


def ticket_usage_limits() -> UsageLimits:
    return UsageLimits(
        request_limit=MAX_MODEL_REQUESTS_PER_TICKET,
        tool_calls_limit=MAX_TOOL_CALLS_PER_TICKET,
        total_tokens_limit=MAX_TOTAL_TOKENS_PER_TICKET,
    )


def mcp_command() -> tuple[str, list[str]]:
    """How the backend starts the MCP server (same launcher .mcp.json uses)."""
    return sys.executable, [str(MCP_LAUNCHER)]
