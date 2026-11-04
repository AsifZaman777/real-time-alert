#!/usr/bin/env python3
"""
Entrypoint to run the BigWarn 45-Portal Super Streamer inside the Backend SoC architecture.
Writes daily logs to `backend/data/logs/` by default and optionally starts the Backend API.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
POC_DIR = ROOT_DIR / "news-live-POC"
if str(POC_DIR) not in sys.path:
    sys.path.insert(0, str(POC_DIR))

from backend.app.core.config import settings  # noqa: E402
import live_news_stream  # noqa: E402

if __name__ == "__main__":
    if "--out-dir" not in sys.argv:
        sys.argv.extend(["--out-dir", str(settings.data_dir)])
    live_news_stream.main()

