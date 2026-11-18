"""
Source Registry for 45 Bangladeshi News Portals (15 English + 30 Bangla).
Provides site definitions, regex compilers, and lookup helpers.
"""
from __future__ import annotations

from backend.ingestion.scraper.live_news_stream import (
    NOT_CATEGORY,
    SECTION_STOP,
    SITE_DEFS,
    compile_sites,
)


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
