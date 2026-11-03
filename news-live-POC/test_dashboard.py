import json, sys, tempfile, urllib.request, urllib.error
from datetime import datetime, timedelta
from pathlib import Path

import live_news_stream as L
import news_dashboard as D

fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond:
        fails.append(name)

tmp = Path(tempfile.mkdtemp())
out = L.Output(tmp)
day = L.now_dhaka().strftime("%Y-%m-%d")
art = lambda h: {"headline": h, "description": "d", "author": "A", "section": "bangladesh",
                 "published": L.now_dhaka(), "updated": None}

# daily files
out.emit("Daily Sun", "https://www.daily-sun.com/bangladesh/1", art("First headline of the day for testing"))
out.note("-- round 1 done")
check("daily jsonl exists", (tmp / "logs" / f"news_stream_{day}.jsonl").exists())
log = (tmp / "logs" / f"news_stream_{day}.log").read_text()
check("log has NEW line with date-time", f"[{day} " in log and "NEW | Daily Sun" in log)
check("log has INFO status line", "INFO | -- round 1 done" in log)

# midnight rollover
class Fake(L.datetime):
    pass
real = L.now_dhaka
tomorrow = real() + timedelta(days=1)
L.now_dhaka = lambda: tomorrow
out.emit("BSS", "https://www.bssnews.net/news/2", art("Second headline after midnight rollover"))
L.now_dhaka = real
d2 = tomorrow.strftime("%Y-%m-%d")
check("rollover makes a new day file", (tmp / "logs" / f"news_stream_{d2}.jsonl").exists())
check("old day file untouched (1 line)", len((tmp / "logs" / f"news_stream_{day}.jsonl").read_text().splitlines()) == 1)

# dashboard
srv = D.serve(tmp / "logs", 0)
port = srv.server_address[1]
import threading; threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{port}"
get = lambda p: urllib.request.urlopen(base + p, timeout=5).read()

html = get("/").decode()
check("page served", "<title>Bangladesh news stream</title>" in html)
check("sort dropdown present", '<select id="sort"' in html)
check("latest updated option present", 'value="updated"' in html)
days = json.loads(get("/api/days"))
check("days lists both files", day in days["days"] and d2 in days["days"], days)
r = json.loads(get(f"/api/items?date={day}&after=0"))
check("items returns the article", r["total"] == 1 and r["items"][0]["source"] == "Daily Sun", r)
r2 = json.loads(get(f"/api/items?date={day}&after=1"))
check("incremental: nothing new after 1", r2["items"] == [] and r2["total"] == 1)
out.emit("Daily Sun", "https://www.daily-sun.com/bangladesh/3", art("Third headline arrives later in the day"))
r3 = json.loads(get(f"/api/items?date={day}&after=1"))
check("incremental: new one appears", len(r3["items"]) == 1 and r3["total"] == 2)
try:
    get("/api/items?date=../../etc/passwd"); bad = False
except urllib.error.HTTPError as e:
    bad = e.code == 400
check("path traversal rejected", bad)
try:
    get("/nope"); nf = False
except urllib.error.HTTPError as e:
    nf = e.code == 404
check("404 on unknown path", nf)
check("missing day -> empty", json.loads(get("/api/items?date=2001-01-01"))["items"] == [])

print("\nFAILED:" if fails else "\nALL PASSED", fails if fails else "")
sys.exit(1 if fails else 0)
