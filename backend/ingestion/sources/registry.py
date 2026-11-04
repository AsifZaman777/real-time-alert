"""
Source Registry for 45 Bangladeshi News Portals (15 English + 30 Bangla).
Provides site definitions, regex compilers, and lookup helpers.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Reuse the verified 45-site definitions from the POC or define directly
POC_DIR = Path(__file__).resolve().parents[3] / "news-live-POC"
if str(POC_DIR) not in sys.path:
    sys.path.insert(0, str(POC_DIR))

from live_news_stream import NOT_CATEGORY, SECTION_STOP, SITE_DEFS, compile_sites  # noqa: E402


def get_all_sources_metadata() -> list[dict]:
    """Returns serializable metadata for all 45 configured news portals."""
    return [
        {
            "key": d["key"],
            "name": d["name"],
            "lang": d.get("lang", "en"),
            "home": d["home"],
            "host": d["host"],
            "feeds": d.get("feeds", []),
            "seeds_count": len(d.get("seeds", [])),
        }
        for d in SITE_DEFS
    ]


__all__ = ["SITE_DEFS", "NOT_CATEGORY", "SECTION_STOP", "compile_sites", "get_all_sources_metadata"]

