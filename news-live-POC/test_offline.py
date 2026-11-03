import json, sys, tempfile, threading
from pathlib import Path
from datetime import datetime

import live_news_stream as L

fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond:
        fails.append(name)

sites = {s["key"]: s for s in L.compile_sites(None)}
check("10 sites", len(sites) == 10, len(sites))

# ---- article URL patterns: (site, url, should_match)
cases = [
    ("prothomalo", "https://en.prothomalo.com/bangladesh/city/w2bsyaxt0x", True),
    ("prothomalo", "https://en.prothomalo.com/bangladesh", False),
    ("thedailystar", "https://www.thedailystar.net/news/crime-justice/news/man-held-4145901", True),
    ("thedailystar", "https://www.thedailystar.net/news/crime-justice", False),
    ("dhakatribune", "https://www.dhakatribune.com/bangladesh/324200/suspected-hacking-knocks-bdnews24", True),
    ("dhakatribune", "https://www.dhakatribune.com/bangladesh/dhaka/145723/dhaka-tribune-s-nazim", True),
    ("dhakatribune", "https://www.dhakatribune.com/bangladesh/dhaka", False),
    ("tbs", "https://www.tbsnews.net/bangladesh/tbs-celebrates-1st-anniversary-wishes-pour-189193", True),
    ("tbs", "https://www.tbsnews.net/node/504494", True),
    ("tbs", "https://www.tbsnews.net/economy/banking", False),
    ("newage", "https://www.newagebd.net/post/country/270010/some-slug", True),
    ("newage", "https://www.newagebd.net/article/123456/some-slug", True),
    ("dailysun", "https://www.daily-sun.com/bangladesh/905537", True),
    ("dailysun", "https://www.daily-sun.com/printversion/details/390258/2019/05/06/x", False),
    ("financialexpress", "https://thefinancialexpress.com.bd/national/fe-celebrates-31st-anniversary", True),
    ("financialexpress", "https://thefinancialexpress.com.bd/bangla/economy/global/some-long-slug-here", False),
    ("bss", "https://www.bssnews.net/news/204484", True),
    ("bss", "https://www.bssnews.net/news-flash/418638", True),
    ("bss", "https://www.bssnews.net/others/418638/Kader-Gani-Chowdhury-appointed-new-MD-of-BSS", True),
    ("bss", "https://www.bssnews.net/contact-us/14", False),
    ("bss", "https://www.bssnews.net/about-bss/2", False),
    ("bdnews24", "https://bdnews24.com/bangladesh/1fbcd23a5c2b", True),
    ("bdnews24", "https://bdnews24.com/bangladesh/high-court-summons-daily-sun-editor", True),
    ("bdnews24", "https://bdnews24.com/bangladesh", False),
    ("unb", "https://unb.com.bd/category/Bangladesh/dcs-conference-unb-advocates-for-integrity/152660", True),
    ("unb", "https://unb.com.bd/category/Bangladesh", False),
]
for key, url, want in cases:
    got = bool(sites[key]["article_re"].match(L.clean_url(url, sites[key])))
    check(f"match {key} {url[-40:]}", got == want, f"got {got}")

# ---- id de-duplication across URL forms
bss = sites["bss"]
k1 = L.art_key(bss, "https://www.bssnews.net/news-flash/418638")
k2 = L.art_key(bss, "https://www.bssnews.net/others/418638/Kader-Gani")
check("bss same id -> same key", k1 == k2 == "bss:418638", (k1, k2))
tbs = sites["tbs"]
check("tbs node/slug same key", L.art_key(tbs, "https://www.tbsnews.net/node/504494")
      == L.art_key(tbs, "https://www.tbsnews.net/supplement/going-504494"))

# ---- host normalisation (non-www -> declared host)
check("clean_url host", L.clean_url("http://tbsnews.net/economy/x-123456/?a=1#z", tbs)
      == "https://www.tbsnews.net/economy/x-123456")

# ---- text dates
d = L.parse_text_date(L.PUBLISHED_LABEL, "Published : 23 Oct 2013, 06:00 PM")
check("date: 23 Oct 2013 6pm", d == datetime(2013, 10, 23, 18, 0, tzinfo=L.DHAKA), d)
d = L.parse_text_date(L.UPDATED_LABEL, "Updated: 29 Oct 2026, 05: 48")
check("date: updated 05: 48", d == datetime(2026, 10, 29, 5, 48, tzinfo=L.DHAKA), d)
d = L.parse_text_date(L.PUBLISHED_LABEL, "Published : Sunday, 11 January, 2026 at 12:00 AM")
check("date: observer style", d == datetime(2026, 1, 11, 0, 0, tzinfo=L.DHAKA), d)
d = L.parse_text_date(L.PUBLISHED_LABEL, "Published at 03:15 pm April 19th, 2013")
check("date: tribune style", d == datetime(2013, 4, 19, 15, 15, tzinfo=L.DHAKA), d)
d = L.parse_text_date(L.UPDATED_LABEL, "Update : 30 Aug 2026, 16:53")
check("date: BSS 24h", d == datetime(2026, 8, 30, 16, 53, tzinfo=L.DHAKA), d)
d = L.parse_text_date(L.PUBLISHED_LABEL, "Published : 29 October 2026")
check("date: no time", d == datetime(2026, 10, 29, 0, 0, tzinfo=L.DHAKA), d)

# ---- article parsing
now = L.now_dhaka()
iso = now.strftime("%Y-%m-%dT%H:%M:%S+06:00")
html = f"""<html><head><meta property="og:type" content="article">
<meta property="og:title" content="Big storm hits coast as thousands flee homes | The Daily Star">
<meta property="og:description" content="desc">
<script type="application/ld+json">{{"@graph":[{{"@type":"NewsArticle","datePublished":"{iso}",
"dateModified":"{iso}","author":[{{"name":"Staff Correspondent"}}],"articleSection":"Bangladesh"}}]}}</script>
</head><body><h1>x</h1></body></html>"""
a = L.parse_article(html, "https://www.thedailystar.net/news/bangladesh/news/storm-1234567", sites["thedailystar"])
check("parse: kind", a and a["kind"] == "article")
check("parse: title suffix stripped", a["headline"] == "Big storm hits coast as thousands flee homes", a["headline"])
check("parse: @graph date + author + section", a["author"] == "Staff Correspondent" and a["section"] == "Bangladesh")
check("classify today", L.classify(a) == "today")

old = html.replace(iso, "2020-01-01T10:00:00+06:00")
check("classify old", L.classify(L.parse_article(old, "https://www.thedailystar.net/x-1234567", sites["thedailystar"])) == "old")

nonart = html.replace('content="article"', 'content="website"')
r = L.parse_article(nonart, "https://bdnews24.com/bangladesh/economy-news", sites["bdnews24"])
check("og:type website -> not_article", r == {"kind": "not_article"})

text_only = ("<html><head><title>t</title><meta property='og:title' content='Dhaka Tribune story headline here'></head>"
             "<body><div>Published at 03:15 pm " + now.strftime("%B %d").replace(" 0", " ").split()[0] + " "
             + str(now.day) + "th, " + str(now.year) + "</div></body></html>")
t = L.parse_article(text_only, "https://www.dhakatribune.com/bangladesh/dhaka/145723/x", sites["dhakatribune"])
check("parse: visible text date", t and t["published"] and t["published"].date() == now.date(), t)

# ---- section from URL
check("section dt", L._section_from_url("https://www.dhakatribune.com/bangladesh/dhaka/145723/slug", sites["dhakatribune"]) == "bangladesh/dhaka")
check("section dailysun", L._section_from_url("https://www.daily-sun.com/bangladesh/905537", sites["dailysun"]) == "bangladesh")
check("section unb", L._section_from_url("https://unb.com.bd/category/Bangladesh/slug/152660", sites["unb"]) == "Bangladesh")
check("section daily star", L._section_from_url("https://www.thedailystar.net/news/bangladesh/crime-justice/news/slug-123456", sites["thedailystar"]) == "bangladesh/crime-justice")

# ---- category discovery
nav = """<nav><a href="/bangladesh">Bangladesh</a><a href="/bangladesh/crime">Crime</a>
<a href="/business">Business</a><a href="/e-paper">E-paper</a><a href="/about-us">About</a>
<a href="/tag/foo">tag</a><a href="/bangladesh/324200/some-article">art</a>
<a href="https://facebook.com/x">fb</a><a href="/world/a-very-long-hyphenated-article-slug-here">long</a>
<a href="/opinion">Opinion</a></nav>"""
cats = L.discover_categories(nav, {**sites["dhakatribune"], "home": "https://www.dhakatribune.com/"}, 25)
paths = [L.urlparse(c).path for c in cats]
check("discover keeps categories", {"/bangladesh", "/bangladesh/crime", "/business", "/opinion"} <= set(paths), paths)
check("discover drops junk", not any(x in p for p in paths for x in ("e-paper", "about", "tag", "324200", "facebook", "hyphenated")), paths)

# ---- end-to-end round with a fake network
today_iso = iso
def page(title, pub):
    return (f'<html><head><meta property="og:type" content="article"><meta property="og:title" content="{title}">'
            f'<script type="application/ld+json">{{"datePublished":"{pub}"}}</script></head><body></body></html>')
PAGES = {
    "https://www.daily-sun.com/": '<a href="/bangladesh/905537">a</a><a href="/bangladesh/905001">b</a><a href="/opinion">o</a>',
    "https://www.daily-sun.com/opinion": '<a href="/opinion/905130">c</a>',
    "https://www.daily-sun.com/bangladesh": '<a href="/bangladesh/905537">dup</a>',
    "https://www.daily-sun.com/bangladesh/905537": page("Daily Sun renews pledge to uphold truth on anniversary", today_iso),
    "https://www.daily-sun.com/bangladesh/905001": page("An old story from last year about floods", "2025-01-01T10:00:00+06:00"),
    "https://www.daily-sun.com/opinion/905130": page("Sixteen years of witnessing change in the country", today_iso),
    "https://www.bssnews.net/": '<a href="/news-flash/418638">x</a><a href="/others/418638/slug">same</a>',
    "https://www.bssnews.net/news-flash/418638": page("Daily Sun renews pledge to uphold truth on anniversary", today_iso),
}
class FakeFetcher(L.Fetcher):
    def get(self, url, tries=2, robots=True):
        self.status = 200 if url in PAGES else 404
        return PAGES.get(url)
tmp = Path(tempfile.mkdtemp())
class A: pass
args = L.parse_args.__wrapped__() if hasattr(L.parse_args, "__wrapped__") else None
sys.argv = ["x", "--out-dir", str(tmp), "--article-pause-min", "0", "--article-pause-max", "0"]
args = L.parse_args()
ss = L.compile_sites({"dailysun", "bss"})
out = L.Output(tmp)
fetchers = {s["key"]: FakeFetcher(args.user_agent, False) for s in ss}
ctx = L.Ctx(args, out, {}, fetchers)
total = sum(L.safe_scrape(ctx, s, 1, True) for s in ss)
check("e2e: 3 today (2 sun + 1 bss)", total == 3, total)
lines = [json.loads(x) for x in (tmp / "logs" / f"news_stream_{L.now_dhaka():%Y-%m-%d}.jsonl").read_text().splitlines()]
check("e2e: jsonl 3 lines", len(lines) == 3, len(lines))
check("e2e: old article not emitted", all("old story" not in l["headline"] for l in lines))
dups = [l for l in lines if l["duplicate_of"]]
check("e2e: cross-site duplicate flagged", len(dups) == 1 and dups[0]["source"] == "Bangladesh Sangbad Sangstha", dups)
check("e2e: bss id dedup (1 bss article)", sum(l["source"].startswith("Bangladesh Sangbad") for l in lines) == 1)
total2 = sum(L.safe_scrape(ctx, s, 2, False) for s in ss)
check("e2e: round 2 emits nothing again", total2 == 0, total2)

print("\nFAILED:" if fails else "\nALL PASSED", fails if fails else "")
sys.exit(1 if fails else 0)
