"""
Article HTML/JSON-LD/Meta Parser & Bilingual Date Normalizer.
"""
from __future__ import annotations

import sys
from pathlib import Path

POC_DIR = Path(__file__).resolve().parents[3] / "news-live-POC"
if str(POC_DIR) not in sys.path:
    sys.path.insert(0, str(POC_DIR))

from live_news_stream import (  # noqa: E402
    PUBLISHED_LABEL,
    UPDATED_LABEL,
    art_key,
    classify,
    clean_url,
    discover_categories,
    extract_feed_links,
    extract_links,
    normalize_bn_date_text,
    parse_article,
    parse_iso,
    parse_text_date,
)

__all__ = [
    "PUBLISHED_LABEL",
    "UPDATED_LABEL",
    "art_key",
    "classify",
    "clean_url",
    "discover_categories",
    "extract_feed_links",
    "extract_links",
    "normalize_bn_date_text",
    "parse_article",
    "parse_iso",
    "parse_text_date",
]

