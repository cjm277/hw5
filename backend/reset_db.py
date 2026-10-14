"""Reset the working database: copy data/campus_customs.db over data/campus_customs_new.db.

Run this before every full ticket run. The original is only ever read.
"""

from __future__ import annotations

import hashlib
import shutil

from config import ORIGINAL_DB, WORKING_DB


def _sha(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reset_working_db() -> None:
    if not ORIGINAL_DB.exists():
        raise SystemExit(f"Original database missing: {ORIGINAL_DB}")
    shutil.copyfile(ORIGINAL_DB, WORKING_DB)
    if _sha(ORIGINAL_DB) != _sha(WORKING_DB):
        raise SystemExit("Reset failed: working copy does not match the original.")
    print(f"Reset {WORKING_DB.name} from {ORIGINAL_DB.name} (identical).")


if __name__ == "__main__":
    reset_working_db()
