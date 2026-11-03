#!/usr/bin/env python3
"""
Live news stream scraper, 10 Bangladeshi news sites
---------------------------------------------------
Watches the home page AND every category page of ten news sites, finds each
article published TODAY (Dhaka time, UTC+6) and pushes every new one into a
stream:

    prothomalo      Prothom Alo (English)     en.prothomalo.com
    thedailystar    The Daily Star            www.thedailystar.net
    dhakatribune    Dhaka Tribune             www.dhakatribune.com
    tbs             The Business Standard     www.tbsnews.net
    newage          New Age                   www.newagebd.net
    dailysun        Daily Sun                 www.daily-sun.com
    financialexpress The Financial Express    thefinancialexpress.com.bd
    bss             Bangladesh Sangbad Sangstha  www.bssnews.net
    bdnews24        bdnews24.com (English)    bdnews24.com
    unb             United News of Bangladesh unb.com.bd

How it works
  * Categories are discovered from each site's own navigation (plus a few
    seed categories), so new sections are picked up without code changes.
  * The home page of every site is read each round. Category pages are read
    round-robin (a few per round) so no site is hammered; on the first round
    all categories are read once as a backfill of today's earlier articles.
  * Only unseen article pages are downloaded, then the publish date is read
    (JSON-LD, meta tags, or the visible "Published" text) and only articles
    dated today are emitted.
  * One worker per site runs in parallel; each site is fetched politely
    (random pauses, robots.txt incl. Crawl-delay, back-off when a site fails).
  * The same wire story appearing in several papers is flagged with
    "duplicate_of" so you can keep or drop it later.

Output (in --out-dir):
    logs/news_stream_YYYY-MM-DD.log     human readable log, one file per Dhaka day
    logs/news_stream_YYYY-MM-DD.jsonl   one JSON object per line (easy to load into Spark)
    seen_urls.json                      memory of handled articles, so a restart does not repeat
Dashboard: add --ui and open http://127.0.0.1:8765 (needs news_dashboard.py next to this file;
           it can also run alone:  python news_dashboard.py --logs logs)

Install:   pip install requests beautifulsoup4
Run:       python live_news_stream.py
Test:      python live_news_stream.py --check        (verify each site's rules)
           python live_news_stream.py --once         (one round, then stop)
Options:   python live_news_stream.py --help

Be polite and check each site's terms of use before using the data for
anything beyond your coursework.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import robotparser
from urllib.parse import urldefrag, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

DHAKA = timezone(timedelta(hours=6))  # Bangladesh has no daylight saving time

DEFAULT_UA = (
    "Mozilla/5.0 (compatible; UniversityNewsStreamBot/1.0; "
    "coursework project; +mailto:your-email@example.com)"
)

# ---------------------------------------------------------------- sources ---
# article_re : full (https, canonical host, no query, no trailing slash) URL of an article
# id_re      : group 1 = the article id, used so one story reached through two URLs counts once
# need_og_article : the article pattern is loose, so confirm with og:type=article on the page
# seeds      : category paths always scanned in addition to the discovered ones
# pages      : pagination pattern for the first-round backfill of category pages
# cat_depth  : max path segments of a category URL found in the navigation
SITE_DEFS = [
    {
        "key": "prothomalo", "name": "Prothom Alo", "names": ["Prothom Alo"],
        "home": "https://en.prothomalo.com/", "host": "en.prothomalo.com",
        "article_re": r"^https://en\.prothomalo\.com/(?:[a-z0-9-]+/)+[a-z0-9]{10}$",
        "id_re": r"/([a-z0-9]{10})$",
        "need_og_article": True,
        "seeds": ["bangladesh", "international", "sports", "opinion", "business",
                  "youth", "entertainment", "lifestyle"],
    },
    {
        "key": "thedailystar", "name": "The Daily Star", "names": ["The Daily Star", "Daily Star"],
        "home": "https://www.thedailystar.net/", "host": "www.thedailystar.net",
        "article_re": r"^https://www\.thedailystar\.net/(?:[a-z0-9-]+/)+[a-z0-9%._-]+-\d{6,}$",
        "id_re": r"-(\d{6,})$",
        "need_og_article": False,
        "seeds": ["news/crime-justice", "news/bangladesh", "news/world", "business",
                  "sports", "opinion", "entertainment", "lifestyle", "tech-startup"],
        "pages": "?page={n}", "cat_depth": 3,
    },
    {
        "key": "dhakatribune", "name": "Dhaka Tribune", "names": ["Dhaka Tribune"],
        "home": "https://www.dhakatribune.com/", "host": "www.dhakatribune.com",
        "article_re": r"^https://www\.dhakatribune\.com/(?:[a-z0-9-]+/)+\d{5,7}/[^/]+$",
        "id_re": r"/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["bangladesh", "business", "world", "sport", "opinion", "feature"],
        "cat_depth": 3,
    },
    {
        "key": "tbs", "name": "The Business Standard", "names": ["The Business Standard", "TBS"],
        "home": "https://www.tbsnews.net/", "host": "www.tbsnews.net",
        "article_re": (r"^https://www\.tbsnews\.net/(?:(?:[a-z0-9-]+/)+[a-z0-9%._-]+-\d{4,7}"
                       r"|node/\d{4,7})$"),
        "id_re": r"(?:-|node/)(\d{4,7})$",
        "need_og_article": False,
        "seeds": ["economy", "bangladesh", "world", "features", "sports"],
        "pages": "?page={n}",
    },
    {
        "key": "newage", "name": "New Age", "names": ["New Age", "New Age Bangladesh"],
        "home": "https://www.newagebd.net/", "host": "www.newagebd.net",
        "article_re": (r"^https://www\.newagebd\.net/(?:post|article)/(?:[a-z0-9-]+/)*"
                       r"\d{4,7}(?:/[^/]+)?$"),
        "id_re": r"/(\d{4,7})(?:/|$)",
        "need_og_article": False,
        "seeds": [], "cat_depth": 3,
    },
    {
        "key": "dailysun", "name": "Daily Sun", "names": ["Daily Sun", "The Daily Sun"],
        "home": "https://www.daily-sun.com/", "host": "www.daily-sun.com",
        "article_re": r"^https://www\.daily-sun\.com/(?:[a-z0-9-]+/)+\d{5,7}$",
        "id_re": r"/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["bangladesh", "opinion", "media"],
    },
    {
        "key": "financialexpress", "name": "The Financial Express",
        "names": ["The Financial Express", "Financial Express"],
        "home": "https://thefinancialexpress.com.bd/", "host": "thefinancialexpress.com.bd",
        # article slugs and category paths look alike, so og:type decides
        "article_re": (r"^https://thefinancialexpress\.com\.bd/"
                       r"(?!bangla/|tag/|reporter/|print/|page/|about-us|epaper)"
                       r"(?:[a-z0-9-]+/)+[a-z0-9-]{10,}$"),
        "id_re": r"-(\d{9,11})$",
        "need_og_article": True,
        "seeds": ["economy", "stock", "national", "world", "sports", "lifestyle"],
    },
    {
        "key": "bss", "name": "Bangladesh Sangbad Sangstha", "names": ["BSS", "Bangladesh Sangbad Sangstha"],
        "home": "https://www.bssnews.net/", "host": "www.bssnews.net",
        "article_re": (r"^https://www\.bssnews\.net/(?!bangla/|about-bss/|contact-us/)"
                       r"[a-z-]+/\d{5,7}(?:/[^/]+)?$"),
        "id_re": r"/(\d{5,7})(?:/|$)",
        "need_og_article": False,
        "seeds": [],
    },
    {
        "key": "bdnews24", "name": "bdnews24.com", "names": ["bdnews24.com", "bdnews24"],
        "home": "https://bdnews24.com/", "host": "bdnews24.com",
        # article slugs / hex ids and sub-category paths look alike, so og:type decides
        "article_re": r"^https://bdnews24\.com/(?!tube/|photos/|bangla/)[a-z-]+/[a-z0-9-]{8,}$",
        "need_og_article": True,
        "seeds": ["bangladesh", "politics", "economy", "business", "world", "sport",
                  "opinion", "entertainment", "lifestyle", "technology", "health",
                  "environment", "education", "campus", "media"],
    },
    {
        "key": "unb", "name": "United News of Bangladesh", "names": ["UNB", "United News of Bangladesh"],
        "home": "https://unb.com.bd/", "host": "unb.com.bd",
        "article_re": r"^https://unb\.com\.bd/category/[A-Za-z0-9-]+/[^/]+/\d+$",
        "id_re": r"/(\d+)$",
        "need_og_article": False,
        "seeds": ["category/Bangladesh"],
        "section_re": r"/category/([^/]+)/",
    },
]

# Paths that are never news categories (used only when discovering categories).
NOT_CATEGORY = re.compile(
    r"/(?:tags?|topics?|authors?|reporters?|page|print|printversion|search|about|about-us|"
    r"contact|contact-us|e-?paper|archive|photos?|photo-gallery|gallery|videos?|tube|live|"
    r"rss|sitemap|login|signin|subscribe|privacy[a-z-]*|terms[a-z-]*|advertis[a-z-]*|"
    r"cartoons?|bangla|bn|taxonomy|node|jobs?|careers?|comment-policy|policy)(?=/)",
    re.I,
)
SECTION_STOP = {"news", "category", "post", "article", "node", "en"}


def compile_sites(only: set[str] | None) -> list[dict]:
    sites = []
    for d in SITE_DEFS:
        if only and d["key"] not in only:
            continue
        s = dict(d)
        s["article_re"] = re.compile(d["article_re"])
        s["id_re"] = re.compile(d["id_re"]) if d.get("id_re") else None
        s["section_re"] = re.compile(d["section_re"]) if d.get("section_re") else None
        s["title_re"] = re.compile(
            r"\s*[|\u2013\u2014-]\s*(?:%s)\s*$" % "|".join(re.escape(n) for n in d["names"]), re.I)
        s.setdefault("cat_depth", 2)
        s.setdefault("pages", None)
        sites.append(s)
    return sites


# ---------------------------------------------------------------- helpers ---
def now_dhaka() -> datetime:
    return datetime.now(DHAKA)


MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}

PUBLISHED_LABEL = r"(?:Published|Publish|Posted)"
UPDATED_LABEL = r"(?:Updated?|Last\s+updated?|Modified)"


def parse_iso(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    s = value.strip().replace("Z", "+00:00")
    s = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", s)
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=DHAKA)
    return dt.astimezone(DHAKA)


def _make_date(day, mon, year, hh=None, mm=None, ap=None) -> datetime | None:
    month = MONTHS.get(str(mon)[:3].lower())
    if not month:
        return None
    h = int(hh or 0)
    if ap:
        h = h % 12 + (12 if ap.lower() == "pm" else 0)
    try:
        return datetime(int(year), month, int(day), h, int(mm or 0), tzinfo=DHAKA)
    except ValueError:
        return None


def parse_text_date(label: str, text: str) -> datetime | None:
    """Reads visible dates such as
         'Published : 23 Oct 2013, 06:00 PM'      'Updated: 29 Oct 2026, 05: 48'
         'Published : Sunday, 11 January, 2026 at 12:00 AM'
         'Published at 03:15 pm April 19th, 2013'
    """
    m = re.search(
        label + r"\s*(?:at|on)?\s*:?\s*(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})"
        r"(?:\s*(?:,|at)?\s*(\d{1,2})\s*:\s*(\d{2})\s*([AaPp][Mm])?)?",
        text, re.I)
    if m:
        day, mon, year, hh, mm, ap = m.groups()
        d = _make_date(day, mon, year, hh, mm, ap)
        if d:
            return d
    m = re.search(
        label + r"\s*(?:at|on)?\s*:?\s*(\d{1,2})\s*:\s*(\d{2})\s*([AaPp][Mm])\s+"
        r"([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})",
        text, re.I)
    if m:
        hh, mm, ap, mon, day, year = m.groups()
        return _make_date(day, mon, year, hh, mm, ap)
    return None


def same_host(a: str, b: str) -> bool:
    def strip(h):
        h = h.lower()
        return h[4:] if h.startswith("www.") else h
    return strip(a) == strip(b)


def clean_url(url: str, site: dict) -> str:
    url = urldefrag(url)[0].split("?")[0].rstrip("/")
    p = urlparse(url)
    if p.scheme in ("http", "https") and same_host(p.netloc, site["host"]):
        url = f"https://{site['host']}{p.path}"
    return url


def art_key(site: dict, url: str) -> str:
    """Identity of an article: its id when known (so /news/1 and /news-flash/1 match)."""
    if site["id_re"]:
        m = site["id_re"].search(url)
        if m:
            return f"{site['key']}:{m.group(1)}"
    return url


def robots_token(ua: str) -> str:
    m = re.search(r"compatible;\s*([\w-]+)", ua)
    return m.group(1) if m else "*"


class Fetcher:
    """One per site: a session, robots.txt rules and a polite pause."""

    def __init__(self, user_agent: str, verbose: bool, check_robots: bool = True):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": user_agent, "Accept-Language": "en"})
        self.ua = user_agent
        self.verbose = verbose
        self.check_robots = check_robots
        self.rp: robotparser.RobotFileParser | None = None
        self.crawl_delay: float = 0.0
        self.status = 0

    def load_robots(self, home: str) -> None:
        p = urlparse(home)
        text = self.get(f"{p.scheme}://{p.netloc}/robots.txt", tries=1, robots=False)
        if text is None:
            return  # no robots.txt reachable, so nothing says no
        rp = robotparser.RobotFileParser()
        rp.parse(text.splitlines())
        self.rp = rp
        cd = rp.crawl_delay(robots_token(self.ua))
        if cd:
            self.crawl_delay = float(cd)

    def allowed(self, url: str) -> bool:
        if not self.check_robots or self.rp is None:
            return True
        return self.rp.can_fetch(robots_token(self.ua), url)

    def get(self, url: str, tries: int = 2, robots: bool = True) -> str | None:
        if robots and not self.allowed(url):
            self.status = -1
            if self.verbose:
                print(f"   ! robots.txt disallows {url}", file=sys.stderr)
            return None
        for attempt in range(tries):
            try:
                r = self.s.get(url, timeout=20)
                self.status = r.status_code
                if r.status_code == 200:
                    if "charset" not in r.headers.get("Content-Type", "").lower():
                        r.encoding = "utf-8"
                    return r.text
                if self.verbose or r.status_code in (403, 429):
                    print(f"   ! HTTP {r.status_code} for {url}", file=sys.stderr)
                if r.status_code in (403, 404, 410):
                    return None
            except requests.RequestException as e:
                self.status = 0
                if self.verbose:
                    print(f"   ! {type(e).__name__} for {url}", file=sys.stderr)
            time.sleep(1.5 * (attempt + 1))
        return None


def extract_links(html: str, base: str, site: dict) -> dict[str, str]:
    """Article links on a listing page, in page order: {article key: url}."""
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        url = clean_url(urljoin(base, href), site)
        if site["article_re"].match(url):
            out.setdefault(art_key(site, url), url)
    return out


def discover_categories(html: str, site: dict, limit: int) -> list[str]:
    """Category pages found in the site's own navigation, plus the seed categories."""
    home = site["home"]
    cats: list[str] = []
    seen: set[str] = set()

    def add(url: str):
        if url not in seen and clean_url(url, site) != clean_url(home, site):
            seen.add(url)
            cats.append(url)

    for s in site["seeds"]:
        add(clean_url(urljoin(home, s), site))
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        url = clean_url(urljoin(home, href), site)
        p = urlparse(url)
        if not same_host(p.netloc, site["host"]):
            continue
        parts = [x for x in p.path.split("/") if x]
        if not parts or len(parts) > site["cat_depth"]:
            continue
        if any(x.isdigit() for x in parts):
            continue
        if len(parts[-1].split("-")) > 4:      # long hyphenated slug = an article, not a category
            continue
        if NOT_CATEGORY.search("/" + "/".join(parts) + "/"):
            continue
        if site["article_re"].match(url) and not site["need_og_article"]:
            continue
        add(url)
    return cats[:limit]


def _iter_ld(node):
    if isinstance(node, list):
        for x in node:
            yield from _iter_ld(x)
    elif isinstance(node, dict):
        yield node
        if "@graph" in node:
            yield from _iter_ld(node["@graph"])


def _section_from_url(url: str, site: dict) -> str:
    if site["section_re"]:
        m = site["section_re"].search(url)
        if m:
            return m.group(1)
    parts = [p for p in urlparse(url).path.split("/") if p]
    if not parts:
        return "-"
    last_is_id = parts[-1].isdigit()
    keep = [p for p in parts if not p.isdigit() and p.lower() not in SECTION_STOP]
    if not last_is_id and keep:
        keep = keep[:-1]  # the last piece is the article slug
    return "/".join(keep) or "-"


def parse_article(html: str, url: str, site: dict) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")

    def meta(*names):
        for n in names:
            for attr in ("property", "name", "itemprop"):
                tag = soup.find("meta", attrs={attr: n})
                if tag and tag.get("content"):
                    return tag["content"].strip()
        return None

    if site["need_og_article"] and (meta("og:type") or "").lower() != "article":
        return {"kind": "not_article"}

    title = meta("og:title")
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(" ", strip=True) if h1 else None
    if not title:
        return None
    title = site["title_re"].sub("", title).strip()

    published = updated = None
    author = meta("author")
    section = meta("article:section")
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (ValueError, TypeError):
            continue
        for item in _iter_ld(data):
            published = published or parse_iso(item.get("datePublished"))
            updated = updated or parse_iso(item.get("dateModified"))
            if not author and item.get("author"):
                a = item["author"]
                a = a if isinstance(a, list) else [a]
                names = [x.get("name") if isinstance(x, dict) else x for x in a]
                author = ", ".join(n for n in names[:3] if isinstance(n, str)) or None
            if not section and item.get("articleSection"):
                sec = item["articleSection"]
                section = ", ".join(sec) if isinstance(sec, list) else str(sec)
    published = published or parse_iso(meta(
        "article:published_time", "og:article:published_time", "datePublished",
        "pubdate", "publish-date", "date", "DC.date.issued"))
    updated = updated or parse_iso(meta(
        "article:modified_time", "og:updated_time", "dateModified", "last-modified"))
    if not published:
        t = soup.find("time", attrs={"itemprop": "datePublished"}) or soup.find("time", attrs={"datetime": True})
        if t is not None:
            published = parse_iso(t.get("datetime"))

    text = soup.get_text(" ", strip=True)
    published = published or parse_text_date(PUBLISHED_LABEL, text)
    updated = updated or parse_text_date(UPDATED_LABEL, text)

    return {
        "kind": "article",
        "headline": title,
        "description": meta("og:description", "description") or "",
        "author": author or "",
        "section": section or _section_from_url(url, site),
        "published": published,
        "updated": updated,
    }


# ----------------------------------------------------------------- output ---
class Output:
    """Writes one pair of files per Dhaka day: logs/news_stream_YYYY-MM-DD.log / .jsonl.
    A new pair starts by itself at midnight, so a long run never makes one giant file."""

    def __init__(self, folder: Path):
        folder.mkdir(parents=True, exist_ok=True)
        self.folder = folder
        self.logdir = folder / "logs"
        self.logdir.mkdir(exist_ok=True)
        self.seen_path = folder / "seen_urls.json"
        self.lock = threading.Lock()
        self.headlines: dict[str, str] = {}   # normalised headline -> first source
        self.day = None
        self.log = self.jsonl = None
        self._roll(now_dhaka())

    def _roll(self, ts: datetime) -> None:
        if ts.date() == self.day:
            return
        for f in (self.log, self.jsonl):
            if f:
                f.close()
        self.day = ts.date()
        self.headlines.clear()   # "also in" only compares stories of the same day
        stem = self.logdir / f"news_stream_{self.day:%Y-%m-%d}"
        self.log = open(f"{stem}.log", "a", encoding="utf-8")
        self.jsonl = open(f"{stem}.jsonl", "a", encoding="utf-8")

    @staticmethod
    def _norm(h: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", h.lower()).strip()

    def emit(self, source: str, url: str, art: dict) -> None:
        ts = now_dhaka()
        fmt = lambda d: d.strftime("%Y-%m-%d %H:%M") if d else "unknown"
        with self.lock:
            self._roll(ts)
            norm = self._norm(art["headline"])
            dup = None
            if len(norm) >= 25:
                dup = self.headlines.get(norm)
                self.headlines.setdefault(norm, source)
            line = (
                f"[{ts:%Y-%m-%d %H:%M:%S}] NEW | {source} | {art['headline']}"
                + (f"  (also in {dup})" if dup and dup != source else "")
                + f"\n    link: {url}\n"
                f"    published: {fmt(art['published'])} | updated: {fmt(art['updated'])} "
                f"| section: {art['section']}"
                + (f" | by: {art['author']}" if art["author"] else "")
            )
            print(line, flush=True)
            self.log.write(line + "\n")
            self.log.flush()
            self.jsonl.write(json.dumps({
                "event": "NEW",
                "ingested_at": ts.isoformat(timespec="seconds"),
                "source": source,
                "url": url,
                "headline": art["headline"],
                "description": art["description"],
                "author": art["author"],
                "section": art["section"],
                "published": art["published"].isoformat() if art["published"] else None,
                "updated": art["updated"].isoformat() if art["updated"] else None,
                "duplicate_of": dup if dup and dup != source else None,
            }, ensure_ascii=False) + "\n")
            self.jsonl.flush()

    def note(self, text: str) -> None:
        """Status line: shown on screen and kept in the day's .log with a timestamp."""
        ts = now_dhaka()
        with self.lock:
            print(text, flush=True)
            self._roll(ts)
            for ln in text.strip("\n").splitlines():
                self.log.write(f"[{ts:%Y-%m-%d %H:%M:%S}] INFO | {ln.strip()}\n")
            self.log.flush()

    def load_seen(self) -> dict:
        try:
            return json.loads(self.seen_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def save_seen(self, seen: dict) -> None:
        tmp = self.seen_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(seen, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.seen_path)


# ------------------------------------------------------------------ cycle ---
def classify(art: dict) -> str:
    ref = art["published"] or art["updated"]
    if ref is None:
        return "nodate"
    return "today" if ref.date() == now_dhaka().date() else "old"


class Ctx:
    def __init__(self, args, out, seen, fetchers):
        self.args, self.out, self.seen, self.fetchers = args, out, seen, fetchers
        self.stop = threading.Event()
        self.state: dict[str, dict] = {}   # per site: cats, cursor, disc_round, streak, skip_until
        self.fails: dict[str, int] = {}


def pause(ctx: Ctx, lo: float, hi: float, floor: float) -> None:
    ctx.stop.wait(max(random.uniform(lo, hi), floor))


def scrape_site(ctx: Ctx, site: dict, round_no: int, first_round: bool) -> int:
    args, out, seen = ctx.args, ctx.out, ctx.seen
    f = ctx.fetchers[site["key"]]
    st = ctx.state.setdefault(site["key"], {"cats": None, "cursor": 0, "disc_round": 0,
                                            "streak": 0, "skip_until": 0})
    if round_no < st["skip_until"]:
        return 0

    home_html = f.get(site["home"])
    if home_html is None:
        st["streak"] += 1
        st["skip_until"] = round_no + min(30, 2 ** st["streak"])
        out.note(f"   ! {site['name']}: home page not loaded, pausing this site for "
                 f"{st['skip_until'] - round_no} round(s)")
        return 0
    st["streak"] = 0

    # --- explore categories -------------------------------------------------
    if st["cats"] is None or (not args.no_categories and round_no - st["disc_round"] >= args.rediscover):
        if args.no_categories:
            st["cats"] = []
        else:
            st["cats"] = discover_categories(home_html, site, args.max_categories)
        st["disc_round"] = round_no
        if args.verbose or first_round:
            out.note(f"   {site['name']}: {len(st['cats'])} categor{'y' if len(st['cats']) == 1 else 'ies'} to watch")

    cats = st["cats"]
    if first_round:
        batch = list(cats)
    elif cats:
        k = min(args.cats_per_round, len(cats))
        batch = [cats[(st["cursor"] + i) % len(cats)] for i in range(k)]
        st["cursor"] = (st["cursor"] + k) % len(cats)
    else:
        batch = []

    # --- collect article links (newest first: home, then categories) --------
    links = extract_links(home_html, site["home"], site)
    for cat in batch:
        if ctx.stop.is_set():
            return 0
        npages = args.backfill_pages if (first_round and site["pages"]) else 1
        for n in range(npages):
            url = cat if n == 0 else cat + site["pages"].format(n=n)
            pause(ctx, 0.5, 1.2, f.crawl_delay)
            html = f.get(url)
            if html is None:
                if args.verbose:
                    out.note(f"   ! {site['name']}: could not load {url}")
                break
            for k2, u2 in extract_links(html, url, site).items():
                links.setdefault(k2, u2)

    # --- download only unseen articles, capped per round --------------------
    todo = [(k, u) for k, u in links.items() if k not in seen]
    cap = args.first_round_max if first_round else args.max_articles
    quiet = first_round and args.from_now
    new_today = 0
    for key, url in todo[:cap]:
        if ctx.stop.is_set():
            break
        pause(ctx, args.article_pause_min, args.article_pause_max, f.crawl_delay)
        page = f.get(url)
        if page is None:
            if f.status != -1:   # -1 means robots.txt said no
                ctx.fails[key] = ctx.fails.get(key, 0) + 1
                if ctx.fails[key] >= 3:
                    seen[key] = "failed"
            else:
                seen[key] = "robots"
            continue
        art = parse_article(page, url, site)
        if art is None:
            ctx.fails[key] = ctx.fails.get(key, 0) + 1
            if ctx.fails[key] >= 3:
                seen[key] = "unparsed"
            continue
        if art["kind"] == "not_article":
            seen[key] = "skip"
            continue
        status = classify(art)
        seen[key] = status
        if status == "nodate" and args.verbose:
            out.note(f"   ? {site['name']}: no date found, ignored: {url}")
        if status == "today":
            new_today += 1
            if not quiet:
                out.emit(site["name"], url, art)
    if args.verbose and len(todo) > cap:
        out.note(f"   {site['name']}: {len(todo) - cap} more unseen link(s) left for the next round")
    return new_today


def safe_scrape(ctx, site, round_no, first_round) -> int:
    try:
        return scrape_site(ctx, site, round_no, first_round)
    except Exception as e:  # one broken site must never stop the others
        ctx.out.note(f"   ! {site['name']}: {type(e).__name__}: {e}")
        return 0


# ------------------------------------------------------------------ check ---
def run_check(args, sites) -> None:
    """Quick health check of every site's rules against the live pages."""
    print(f"Checking {len(sites)} site(s) at {now_dhaka():%Y-%m-%d %H:%M:%S} Dhaka time\n")
    for site in sites:
        f = Fetcher(args.user_agent, args.verbose, check_robots=not args.ignore_robots)
        print(f"== {site['name']}  ({site['home']})")
        if not args.ignore_robots:
            f.load_robots(site["home"])
            if not f.allowed(site["home"]):
                print("   robots.txt does not allow this site, skipped\n")
                continue
        html = f.get(site["home"])
        if html is None:
            print(f"   home page not loaded (HTTP {f.status})\n")
            continue
        links = extract_links(html, site["home"], site)
        cats = discover_categories(html, site, args.max_categories)
        print(f"   article links on home page : {len(links)}")
        print(f"   categories found           : {len(cats)}  e.g. "
              + ", ".join(urlparse(c).path or "/" for c in cats[:6]))
        sample = list(links.values())[:1]
        if not links and cats:
            time.sleep(1)
            h2 = f.get(cats[0])
            if h2:
                links = extract_links(h2, cats[0], site)
                sample = list(links.values())[:1]
                print(f"   article links on {urlparse(cats[0]).path}: {len(links)}")
        if sample:
            time.sleep(1)
            page = f.get(sample[0])
            art = parse_article(page, sample[0], site) if page else None
            if art and art.get("kind") == "article":
                print(f"   sample article             : {art['headline'][:70]}")
                print(f"   date read                  : published={art['published']} "
                      f"updated={art['updated']} -> {classify(art)}")
            else:
                print(f"   sample article could not be parsed: {sample[0]}")
        else:
            print("   no article links matched: the URL pattern for this site needs a look")
        print()


# ------------------------------------------------------------------- main ---
def parse_args():
    p = argparse.ArgumentParser(description="Live stream of today's Bangladeshi news from 10 sites")
    p.add_argument("--min-delay", type=float, default=10, help="min seconds between rounds (default 10)")
    p.add_argument("--max-delay", type=float, default=20, help="max seconds between rounds (default 20)")
    p.add_argument("--out-dir", default=".", help="folder for the log files (default: current folder)")
    p.add_argument("--sites", default="", help="comma separated site keys to use (see --list-sites)")
    p.add_argument("--list-sites", action="store_true", help="show the site keys and exit")
    p.add_argument("--check", action="store_true", help="test every site's rules once and exit")
    p.add_argument("--no-categories", action="store_true", help="read only the home pages")
    p.add_argument("--max-categories", type=int, default=25, help="categories watched per site (default 25)")
    p.add_argument("--cats-per-round", type=int, default=3,
                   help="category pages refreshed per site per round after the first round (default 3)")
    p.add_argument("--rediscover", type=int, default=120,
                   help="re-read the navigation for new categories every N rounds (default 120)")
    p.add_argument("--max-articles", type=int, default=40,
                   help="new article pages downloaded per site per round (default 40)")
    p.add_argument("--first-round-max", type=int, default=120,
                   help="same, for the first round (default 120); the rest follow in later rounds")
    p.add_argument("--backfill-pages", type=int, default=2,
                   help="extra pages read per category on the first round where a site has paging (default 2)")
    p.add_argument("--from-now", action="store_true",
                   help="do not print today's earlier articles, only ones published from now on")
    p.add_argument("--once", action="store_true", help="run one round and stop (for testing)")
    p.add_argument("--ignore-robots", action="store_true", help="skip the robots.txt check")
    p.add_argument("--user-agent", default=DEFAULT_UA)
    p.add_argument("--article-pause-min", type=float, default=0.4)
    p.add_argument("--article-pause-max", type=float, default=1.2)
    p.add_argument("--all-sections", action="store_true", help=argparse.SUPPRESS)  # old option, now always on
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--ui", action="store_true", help="also serve the live dashboard in your browser")
    p.add_argument("--port", type=int, default=8765, help="dashboard port (default 8765)")
    return p.parse_args()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    args = parse_args()

    if args.list_sites:
        for d in SITE_DEFS:
            print(f"{d['key']:18} {d['name']:32} {d['home']}")
        return
    only = {x.strip() for x in args.sites.split(",") if x.strip()} or None
    if only:
        unknown = only - {d["key"] for d in SITE_DEFS}
        if unknown:
            sys.exit(f"Unknown site key(s): {', '.join(sorted(unknown))}. Use --list-sites.")
    sites = compile_sites(only)

    if args.check:
        run_check(args, sites)
        return

    out = Output(Path(args.out_dir))
    if args.ui:
        try:
            import news_dashboard
            url = news_dashboard.start_in_thread(out.logdir, args.port)
            out.note(f"Dashboard: open {url} in your browser")
        except Exception as e:
            out.note(f"Dashboard could not start ({type(e).__name__}: {e}); scraping continues")
    fetchers = {s["key"]: Fetcher(args.user_agent, args.verbose, check_robots=not args.ignore_robots)
                for s in sites}

    if not args.ignore_robots:
        allowed = []
        for s in sites:
            f = fetchers[s["key"]]
            f.load_robots(s["home"])
            if f.allowed(s["home"]):
                allowed.append(s)
            else:
                out.note(f"robots.txt does not allow {s['home']}, skipping {s['name']} "
                         f"(use --ignore-robots only if you have permission)")
        sites = allowed
    if not sites:
        out.note("Nothing to scrape.")
        return

    seen = out.load_seen()
    ctx = Ctx(args, out, seen, fetchers)
    rounds, total_new = 0, 0
    out.note(f"Live news stream started {now_dhaka():%Y-%m-%d %H:%M:%S} (Dhaka time). "
             f"Today = {now_dhaka():%d %b %Y}. Press Ctrl+C to stop.")
    out.note(f"Sources: {', '.join(s['name'] for s in sites)}")
    out.note(f"Wait {args.min_delay:.0f}-{args.max_delay:.0f}s between rounds. "
             f"Logs: {Path(args.out_dir).resolve()}")

    pool = ThreadPoolExecutor(max_workers=len(sites))
    try:
        while True:
            rounds += 1
            futures = [(s, pool.submit(safe_scrape, ctx, s, rounds, rounds == 1)) for s in sites]
            counts = {s["name"]: fut.result() for s, fut in futures}
            new = sum(counts.values())
            total_new += new
            out.save_seen(seen)
            wait = random.uniform(args.min_delay, args.max_delay)
            detail = ", ".join(f"{n} {c}" for n, c in counts.items() if c)
            out.note(f"-- round {rounds} done at {now_dhaka():%H:%M:%S}: {new} new today"
                     + (f" ({detail})" if detail else "")
                     + f", {total_new} total this run. Next check in {wait:.0f}s")
            if args.once:
                break
            if ctx.stop.wait(wait):
                break
    except KeyboardInterrupt:
        ctx.stop.set()
    finally:
        ctx.stop.set()
        pool.shutdown(wait=True)
        out.save_seen(seen)
        out.note(f"\nStopped. {total_new} new articles streamed this run. "
                 f"Files: {out.logdir}")


if __name__ == "__main__":
    main()
