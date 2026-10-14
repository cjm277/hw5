"""Append-only audit trail at output/audit_trail.json.

The file is a JSON array that only grows: each agent-loop step adds one entry
and earlier runs are never wiped. Entries are scrubbed of secrets and
account/card-length numbers before they are written.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime
from typing import Any

from pydantic_core import to_jsonable_python

from config import AUDIT_PATH, AUDIT_PREVIEW_CHARS, MODEL_NAME

_lock = threading.Lock()
_LONG_DIGITS = re.compile(r"\b(?:\d[ -]?){12,19}\b")


def _redact(text: str) -> str:
    key = os.getenv("PORTKEY_API_KEY", "").strip()
    if key:
        text = text.replace(key, "[REDACTED_KEY]")
    return _LONG_DIGITS.sub("[REDACTED]", text)


def preview(value: Any, limit: int = AUDIT_PREVIEW_CHARS) -> str:
    text = value if isinstance(value, str) else json.dumps(to_jsonable_python(value), ensure_ascii=False)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def append(event: str, *, run_id: str, ticket_id: int | None, agent: str, depth: int, **fields: Any) -> None:
    """Append one audit entry. Never raises into the agent loop."""
    entry = {
        "time": datetime.now().astimezone().isoformat(timespec="milliseconds"),
        "run_id": run_id,
        "ticket_id": ticket_id,
        "agent": agent,
        "depth": depth,
        "event": event,
        "model": MODEL_NAME,
        **fields,
    }
    safe = json.loads(_redact(json.dumps(to_jsonable_python(entry), ensure_ascii=False)))
    try:
        with _lock:
            AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
            rows: list[Any] = []
            if AUDIT_PATH.exists() and AUDIT_PATH.stat().st_size > 0:
                try:
                    loaded = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
                    rows = loaded if isinstance(loaded, list) else [loaded]
                except json.JSONDecodeError:
                    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                    AUDIT_PATH.replace(AUDIT_PATH.with_name(f"audit_trail.corrupt-{stamp}.json"))
            rows.append(safe)
            tmp = AUDIT_PATH.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(AUDIT_PATH)
    except OSError as exc:  # auditing must not crash a run, but say so loudly
        print(f"[audit] could not write {AUDIT_PATH}: {exc}")
