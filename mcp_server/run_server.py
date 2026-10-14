"""Portable launcher for the Campus Customs MCP server (used by .mcp.json).

Uses only the standard library, so any Python 3 on PATH can run it. It finds
mcp_server/.venv (Windows or macOS/Linux layout), creates it and installs
requirements.txt on first run, then starts server.py with the venv Python.

stdout is the MCP stdio channel, so all setup output goes to stderr.
"""

from __future__ import annotations

import subprocess
import sys
import venv
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"


def venv_python() -> Path:
    win = VENV / "Scripts" / "python.exe"
    return win if win.exists() else VENV / "bin" / "python"


def ensure_venv() -> Path:
    py = venv_python()
    if not py.exists():
        print(f"[run_server] creating {VENV}", file=sys.stderr)
        venv.create(VENV, with_pip=True)
        py = venv_python()
    has_fastmcp = subprocess.run(
        [str(py), "-c", "import fastmcp"], capture_output=True
    ).returncode == 0
    if not has_fastmcp:
        print("[run_server] installing requirements.txt", file=sys.stderr)
        subprocess.run(
            [str(py), "-m", "pip", "install", "-q", "-r", str(HERE / "requirements.txt")],
            stdout=sys.stderr,
            check=True,
        )
    return py


if __name__ == "__main__":
    py = ensure_venv()
    sys.exit(subprocess.call([str(py), str(HERE / "server.py"), *sys.argv[1:]]))
