"""Command line runner for the agent team.

    python backend/run_ticket.py 101           # one ticket (no reset)
    python backend/run_ticket.py --all         # resets the working DB, then every open ticket
    python backend/run_ticket.py --ask inventory "How many CC-HOOD-NAVY in M?"
"""

from __future__ import annotations

import argparse
import asyncio
import json

from pydantic_core import to_jsonable_python

from config import MODEL_NAME, check_model_env


def _print(obj) -> None:
    print(json.dumps(to_jsonable_python(obj), indent=2, ensure_ascii=False))


async def _open_ticket_ids() -> list[int]:
    from fastmcp import Client
    from fastmcp.client.transports import StdioTransport

    from config import ROOT, mcp_command

    command, args = mcp_command()
    async with Client(StdioTransport(command=command, args=args, cwd=str(ROOT))) as client:
        result = await client.call_tool("list_open_tickets", {})
    return [t["id"] for t in result.structured_content["result"]]


async def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Campus Customs agent team")
    parser.add_argument("tickets", nargs="*", type=int, help="ticket ids to work")
    parser.add_argument("--all", action="store_true", help="reset the working DB, then work every open ticket")
    parser.add_argument("--ask", nargs=2, metavar=("AGENT", "QUESTION"), help="ask one agent directly")
    args = parser.parse_args()
    check_model_env()
    print(f"model: {MODEL_NAME} via Portkey")

    from team import ask_agent, run_ticket

    if args.ask:
        from models import AGENT_NAMES

        if args.ask[0] not in AGENT_NAMES:
            parser.error(f"AGENT must be one of {', '.join(AGENT_NAMES)}")
        _print(await ask_agent(args.ask[0], args.ask[1]))
        return
    ids = args.tickets
    if args.all:
        from reset_db import reset_working_db

        reset_working_db()  # required before every full run
        ids = await _open_ticket_ids()
    if not ids:
        parser.error("give ticket ids, --all, or --ask")
    for tid in ids:
        print(f"\n=== ticket {tid} ===")
        _print(await run_ticket(tid))


if __name__ == "__main__":
    asyncio.run(main())
