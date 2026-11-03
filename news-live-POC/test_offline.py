import json, sys, tempfile, threading
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import live_news_stream as L

fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond:
        fails.append(name)

sites = {s["key"]: s for s in L.compile_sites(None)}
check("45 sites (15 EN + 30 BN)", len(sites) == 45, len(sites))
en_sites = L.compile_sites(None, lang_filter="en")
bn_sites = L.compile_sites(None, lang_filter="bn")
check("lang filter: 15 EN and 30 BN", len(en_sites) == 15 and len(bn_sites) == 30, (len(en_sites), len(bn_sites)))

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
    # New English portals
    ("observerbd", "https://observerbd.com/news/603621", True),
    ("bangladeshpost", "https://bangladeshpost.net/posts/pm-meets-president-at-bangabhaban-175166", True),
    ("banglanews24_en", "https://en.banglanews24.com/national/news/bd/197475.details", True),
    ("dailycountrytoday", "https://dailycountrytodaybd.com/story/cabinet-clears-draft-law-to-expedite-solar", True),
    ("viewsbangladesh", "https://viewsbangladesh.com/garment-workers-clash-with-police-at-mirpur", True),
    # New Bangla portals
    ("prothomalo_bn", "https://www.prothomalo.com/bangladesh/crime/zakgd4ohb1", True),
    ("bdnews24_bn", "https://bangla.bdnews24.com/world/qykdkrbmhq", True),
    ("thedailystar_bn", "https://bangla.thedailystar.net/news/bangladesh/news-3976016", True),
    ("dhakatribune_bn", "https://bangla.dhakatribune.com/bangladesh/112385/some-bangla-slug", True),
    ("tbs_bn", "https://www.tbsnews.net/bangla/bangladesh/news-details-560411", True),
    ("bss_bn", "https://www.bssnews.net/bangla/news-flash/356259", True),
    ("unb_bn", "https://unb.com.bd/bangla/category/বাংলাদেশ/সৌরবিদ্যুৎ/116336", True),
    ("jugantor", "https://www.jugantor.com/national/1178626", True),
    ("ittefaq", "https://www.ittefaq.com.bd/818834/some-slug", True),
    ("samakal", "https://samakal.com/capital/article/381166/some-slug", True),
    ("dhakapost", "https://www.dhakapost.com/country/495111", True),
    ("banglanews24_bn", "https://www.banglanews24.com/sports/news/bd/1690896.details", True),
    ("jamuna", "https://www.jamuna.tv/national/667336", True),
    ("independent24", "https://www.itvbd.com/national/277455/some-slug", True),
    ("rtvonline", "https://rtvonline.com/national/413507", True),
    ("ntvbd", "https://www.ntvbd.com/sports/news-1830021", True),
    ("ekattor", "https://ekattor.tv/national/97069/some-slug", True),
    ("banglatribune", "https://www.banglatribune.com/national/978509/some-slug", True),
    ("sarabangla", "https://sarabangla.net/./bangladesh/post-1215803/", True),
    ("ajkerpatrika", "https://www.ajkerpatrika.com/national/ajp0h90876vmk", True),
    ("deshrupantor", "https://www.deshrupantor.com/732373/some-slug", True),
    ("mzamin", "https://www.mzamin.com/article/56136", True),
    ("bhorerkagoj", "https://www.bhorerkagoj.net/national/802948", True),
    ("shomoyeralo", "https://www.shomoyeralo.com/news/393396", True),
    ("sangbad", "https://sangbad.net/news/22464", True),
    ("janakantha", "https://www.dailyjanakantha.com/national/news/918090", True),
    ("manobkantha", "https://manobkantha.com.bd/news/national/673645/some-slug", True),
    ("dhakatimes24", "https://www.dhakatimes24.com/2026/11/03/416373", True),
    ("arthosuchak", "https://www.arthosuchak.com/archives/980724/some-slug", True),
    ("sharebiz", "https://www.sharebiz.net/national/news/179823", True),
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

# ---- host & path normalisation
check("clean_url host", L.clean_url("http://tbsnews.net/economy/x-123456/?a=1#z", tbs)
      == "https://www.tbsnews.net/economy/x-123456")
check("clean_url dot-slash", L.clean_url("https://sarabangla.net/./bangladesh/post-1215803/", sites["sarabangla"])
      == "https://sarabangla.net/bangladesh/post-1215803")

# ---- text dates (English & Bangla)
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
d = L.parse_text_date(L.UPDATED_LABEL, "Update- November 03, 2026, 12:16 PM")
check("date: UNB Month-DD-YYYY style", d == datetime(2026, 11, 3, 12, 16, tzinfo=L.DHAKA), d)
d = L.parse_text_date(L.PUBLISHED_LABEL, "প্রকাশ: ০৩ নভেম্বর ২০২৬, ০৩:২৫ পিএম")
check("date: Bangla digits + month + PM", d == datetime(2026, 11, 3, 15, 25, tzinfo=L.DHAKA), d)
d = L.parse_text_date(L.PUBLISHED_LABEL, "প্রকাশিত: ১০:৩২, ৩ নভেম্বর ২০২৬")
check("date: Janakantha Bangla HH:MM, DD Mon YYYY", d == datetime(2026, 11, 3, 10, 32, tzinfo=L.DHAKA), d)

# ---- article parsing, full body, and disruption/location pre-tagging
now = L.now_dhaka()
iso = now.strftime("%Y-%m-%dT%H:%M:%S+06:00")
html = f"""<html><head><meta property="og:type" content="article">
<meta property="og:title" content="Garment workers block road in Mirpur-10 and Ashulia | The Daily Star">
<meta property="og:description" content="Clashes broke out at 10:30 am during the blockade.">
<script type="application/ld+json">{{"@graph":[{{"@type":"NewsArticle","datePublished":"{iso}",
"dateModified":"{iso}","author":[{{"name":"Staff Correspondent"}}],"articleSection":"Bangladesh"}}]}}
</script></head><body><article><p>Thousands of garment workers staged a road blockade at Mirpur-10 and Ashulia from 9:00 am to 1:00 pm today, halting traffic and clashing with police.</p></article></body></html>"""
a = L.parse_article(html, "https://www.thedailystar.net/news/bangladesh/news/storm-1234567", sites["thedailystar"])
check("parse: kind", a and a["kind"] == "article")
check("parse: title suffix stripped", a["headline"] == "Garment workers block road in Mirpur-10 and Ashulia", a["headline"])
check("parse: @graph date + author + section", a["author"] == "Staff Correspondent" and a["section"] == "Bangladesh")
check("parse: full body extracted", "Thousands of garment workers" in a["body"] and a["word_count"] >= 15, a["body"])
check("parse: disruption events tagged", "blockade" in a["event_types"] and "clash" in a["event_types"] and a["is_disruption"], a["event_types"])
check("parse: locations tagged", "Mirpur-10" in a["locations"] and "Ashulia" in a["locations"], a["locations"])
check("parse: time windows tagged", any("10:30 am" in tw for tw in a["time_windows"]), a["time_windows"])
check("classify today", L.classify(a) == "today")

# Bangla disruption & location tagging test
bn_tags = L.extract_disruption_tags(
    "মিরপুর-১০ ও আশুলিয়ায় পোশাকশ্রমিকদের সড়ক অবরোধ, পুলিশের সঙ্গে সংঘর্ষ",
    "সকাল ১০টা থেকে যান চলাচল বন্ধ রয়েছে।",
    ""
)
check("Bangla disruption & location tags",
      "blockade" in bn_tags["event_types"] and "clash" in bn_tags["event_types"]
      and "Mirpur-10" in bn_tags["locations"] and "Ashulia" in bn_tags["locations"], bn_tags)

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
            f'<script type="application/ld+json">{{"datePublished":"{pub}"}}</script></head>'
            f'<body><article><p>Students blocked Shahbagh intersection at 11:00 am causing heavy traffic gridlock in Dhaka.</p></article></body></html>')
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
check("e2e: Spark schema fields emitted", all("body" in l and "event_types" in l and "locations" in l and "lang" in l for l in lines))
total2 = sum(L.safe_scrape(ctx, s, 2, False) for s in ss)
check("e2e: round 2 emits nothing again", total2 == 0, total2)

print("\nFAILED:" if fails else "\nALL PASSED", fails if fails else "")
sys.exit(1 if fails else 0)
