#!/usr/bin/env python3
"""
Entrypoint to run the BigWarn Backend REST & Stream API Server (http://127.0.0.1:8765).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.api.server import main  # noqa: E402

if __name__ == "__main__":
    main()

