#!/usr/bin/env python3
"""
Debug-Friendly Live Dashboard for the Bangladesh Super News Stream
------------------------------------------------------------------
A local web application (standard library only, nothing to install) that shows
and debugs the articles and scraper logs written by live_news_stream.py.

  * Stream & Search View:
      - Instant full-text search with keyword highlighting across headlines,
        descriptions, full body text, URLs, authors, sections, and locations
      - Multi-sort: Latest updated, Latest published, Arrival order (newest/oldest),
        Article word count (longest/shortest), Ingestion lag (slowest/fastest)
      - Debug & Quality filters: Missing body, Missing published date, Missing updated
        date, Duplicates only, Disruptions only, Location-tagged / untagged
      - Facet filters: Language (EN/BN), Disruption Event Type, Area/Location,
        Section, and interactive Newspaper Source chips
      - Per-article Debug Inspector: Ingestion lag badge, word count / field health
        badges, expandable full text, and `{ } Raw JSON` viewer + copy button
  * Site Health & Debug Matrix View:
      - Per-newspaper breakdown of articles emitted, avg word count, % with body,
        % with published/updated dates, disruption count, and seen_urls.json
        statuses (today, old, nodate, skip, failed, robots)
  * Live Scraper Log Console:
      - Real-time tail of logs/news_stream_YYYY-MM-DD.log with filter for
        All, Errors/Warnings (!), Round Status (INFO), and New Articles (NEW)

Run together with the scraper:   python live_news_stream.py --ui
Run on its own (reads old logs): python news_dashboard.py --logs logs
Then open http://127.0.0.1:8765
"""
from __future__ import annotations

import argparse
import json
import re
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DHAKA = timezone(timedelta(hours=6))
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILE_RE = re.compile(r"^news_stream_(\d{4}-\d{2}-\d{2})\.jsonl$")


def today() -> str:
    return datetime.now(DHAKA).strftime("%Y-%m-%d")


def list_days(logdir: Path) -> list[str]:
    days = {m.group(1) for p in logdir.glob("news_stream_*.jsonl") if (m := FILE_RE.match(p.name))}
    days.add(today())
    return sorted(days, reverse=True)


def read_items(logdir: Path, day: str, after: int) -> tuple[int, list[dict]]:
    """Lines `after`.. of that day's file, plus the total line count."""
    path = logdir / f"news_stream_{day}.jsonl"
    items: list[dict] = []
    total = 0
    try:
        with open(path, encoding="utf-8") as f:
            for total, line in enumerate(f, 1):
                if total <= after:
                    continue
                try:
                    items.append(json.loads(line))
                except ValueError:
                    items.append(None)   # keep numbering stable on a half-written line
    except OSError:
        pass
    return total, [i for i in items if i]


def read_debug_info(logdir: Path, day: str, max_log_lines: int = 300) -> dict:
    """Reads recent .log lines and seen_urls.json statistics for debugging."""
    log_path = logdir / f"news_stream_{day}.log"
    lines: list[str] = []
    try:
        with open(log_path, encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
            lines = [ln.rstrip("\r\n") for ln in all_lines[-max_log_lines:]]
    except OSError:
        pass

    # Look for seen_urls.json in parent folder or logdir
    seen_stats: dict[str, dict[str, int]] = {}
    for cand in (logdir.parent / "seen_urls.json", logdir / "seen_urls.json"):
        if cand.exists():
            try:
                raw = json.loads(cand.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    for k, status in raw.items():
                        site_prefix = k.split(":", 1)[0] if ":" in k and not k.startswith("http") else (
                            urlparse(k).netloc.lower().removeprefix("www.") if k.startswith("http") else "other"
                        )
                        bucket = seen_stats.setdefault(site_prefix, {})
                        st_key = str(status)
                        bucket[st_key] = bucket.get(st_key, 0) + 1
                break
            except (OSError, ValueError):
                pass

    return {
        "date": day,
        "log_lines": lines,
        "seen_stats": seen_stats,
    }


def make_handler(logdir: Path):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # keep the console for the scraper
            pass

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj) -> None:
            self._send(200, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            if u.path in ("/", "/index.html"):
                self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
            elif u.path == "/api/days":
                self._json({"today": today(), "days": list_days(logdir)})
            elif u.path == "/api/items":
                day = (q.get("date") or [today()])[0]
                if not DAY_RE.match(day):
                    return self._send(400, b"bad date", "text/plain")
                try:
                    after = max(0, int((q.get("after") or ["0"])[0]))
                except ValueError:
                    after = 0
                total, items = read_items(logdir, day, after)
                self._json({"date": day, "total": total, "items": items})
            elif u.path == "/api/debug":
                day = (q.get("date") or [today()])[0]
                if not DAY_RE.match(day):
                    return self._send(400, b"bad date", "text/plain")
                self._json(read_debug_info(logdir, day))
            else:
                self._send(404, b"not found", "text/plain")

    return Handler


def serve(logdir: Path, port: int = 8765, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    logdir.mkdir(parents=True, exist_ok=True)
    return ThreadingHTTPServer((host, port), make_handler(logdir))


def start_in_thread(logdir: Path, port: int = 8765) -> str:
    srv = serve(logdir, port)
    threading.Thread(target=srv.serve_forever, daemon=True, name="dashboard").start()
    return f"http://127.0.0.1:{port}"


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bangladesh news stream</title>
<style>
:root{
  --bg:#f4f4f0;--card:#ffffff;--ink:#18181b;--mute:#63635e;--line:#e2e0d8;
  --accent:#0b6b4f;--accent-soft:#e6f4ef;--chip:#eae8e0;--hot:#fff4c9;
  --warn:#b91c1c;--warnbg:#fef2f2;--loc:#1d4ed8;--locbg:#eff6ff;
  --ok:#15803d;--okbg:#f0fdf4;--amber:#b45309;--amberbg:#fffbeb;
  --mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#121312;--card:#1c1e1c;--ink:#ecebe6;--mute:#9a988f;--line:#2e312e;
    --accent:#4fc59a;--accent-soft:#143328;--chip:#262926;--hot:#3b3820;
    --warn:#f87171;--warnbg:#3b1818;--loc:#60a5fa;--locbg:#172554;
    --ok:#4ade80;--okbg:#142e1f;--amber:#fbbf24;--amberbg:#38260c;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14.5px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.wrap{max-width:1280px;margin:0 auto}
.top{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
h1{font-size:17px;margin:0;font-weight:700;letter-spacing:-.2px}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--mute);font-size:12.5px;background:var(--card);padding:3px 9px;border-radius:999px;border:1px solid var(--line)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:p 1.6s infinite}
.dot.off{background:var(--mute);animation:none}
@keyframes p{50%{opacity:.25}}
.sp{flex:1}
.tabs{display:inline-flex;background:var(--chip);padding:3px;border-radius:9px;border:1px solid var(--line);gap:2px}
.tab{border:none;background:transparent;color:var(--mute);font-weight:600;font-size:12.5px;padding:5px 11px;border-radius:6px;cursor:pointer}
.tab.active{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.toolbar{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:9px;padding-top:9px;border-top:1px dashed var(--line)}
input,select,button{font:inherit;font-size:13px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:7px;padding:5px 9px}
input:focus,select:focus{outline:2px solid var(--accent);outline-offset:-1px}
.search-wrap{display:inline-flex;align-items:center;position:relative;flex:1;min-width:220px}
.search-wrap input{width:100%;padding-right:26px}
.clear-btn{position:absolute;right:5px;border:none;background:transparent;color:var(--mute);cursor:pointer;font-size:14px;padding:2px 5px}
button{cursor:pointer;font-weight:500}
button:hover{border-color:var(--accent)}
button.btn-sm{padding:3px 8px;font-size:12px}
label.chk{display:inline-flex;gap:5px;align-items:center;color:var(--mute);font-size:12.5px;cursor:pointer;user-select:none}
.stats-bar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin-top:8px;font-size:12.5px;color:var(--mute)}
.stat-pill{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:2px 8px}
.stat-pill b{color:var(--ink);font-family:var(--mono)}
.stat-pill.warn b{color:var(--warn)}
.stat-pill.ok b{color:var(--ok)}
.chips-bar{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:var(--chip);border-radius:999px;padding:2px 9px;font-size:12px;cursor:pointer;user-select:none;transition:all .12s}
.chip b{font-weight:650;margin-left:4px;font-family:var(--mono)}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
main{max-width:1280px;margin:14px auto 60px;padding:0 16px}
.item{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:11px 14px;margin-bottom:9px;transition:border-color .15s}
.item:hover{border-color:var(--accent)}
.item.disruption{border-left:4px solid var(--warn)}
.item.new{animation:flash 4s ease-out}
@keyframes flash{from{background:var(--hot)}to{background:var(--card)}}
.meta{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:12px;color:var(--mute);align-items:center}
.seq{font-family:var(--mono);font-size:11px;color:var(--mute);background:var(--chip);padding:0 5px;border-radius:4px}
.src{font-weight:700;color:var(--accent)}
.lang{border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:10.5px;font-weight:700;text-transform:uppercase;font-family:var(--mono)}
.dup{border:1px solid var(--line);border-radius:5px;padding:0 6px;font-size:11.5px}
.badge-ev{background:var(--warnbg);color:var(--warn);border:1px solid var(--warn);border-radius:5px;padding:0 6px;font-size:11px;font-weight:600}
.badge-loc{background:var(--locbg);color:var(--loc);border-radius:5px;padding:0 6px;font-size:11px;font-weight:600}
.badge-ok{background:var(--okbg);color:var(--ok);border-radius:5px;padding:0 6px;font-size:11px;font-family:var(--mono)}
.badge-warn{background:var(--amberbg);color:var(--amber);border-radius:5px;padding:0 6px;font-size:11px;font-family:var(--mono)}
.badge-err{background:var(--warnbg);color:var(--warn);border-radius:5px;padding:0 6px;font-size:11px;font-family:var(--mono)}
.upd{color:var(--accent);font-weight:600}
.hl{display:block;margin:5px 0 3px;font-size:16px;font-weight:650;color:var(--ink);text-decoration:none}
.hl:hover{text-decoration:underline}
.desc{color:var(--mute);font-size:13.5px;margin:2px 0 0}
mark{background:var(--hot);color:var(--ink);padding:0 2px;border-radius:3px;font-weight:600}
.debug-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:7px;padding-top:6px;border-top:1px solid var(--line);font-size:12px}
.url-mono{font-family:var(--mono);font-size:11.5px;color:var(--mute);word-break:break-all;flex:1}
details.inspector{margin-top:6px;font-size:13px}
details.inspector summary{cursor:pointer;color:var(--accent);font-size:12px;font-weight:600;display:inline-block;margin-right:12px;user-select:none}
.body-box{margin-top:6px;padding:9px 11px;background:var(--bg);border:1px solid var(--line);border-radius:8px;white-space:pre-line;line-height:1.55;max-height:360px;overflow:auto}
.json-box{margin-top:6px;padding:9px 11px;background:var(--bg);border:1px solid var(--line);border-radius:8px;font:12px/1.45 var(--mono);white-space:pre-wrap;word-break:break-all;max-height:360px;overflow:auto}
.empty{text-align:center;color:var(--mute);padding:50px 0}
/* Matrix & Log Console */
.panel{display:none}
.panel.active{display:block}
.table-wrap{background:var(--card);border:1px solid var(--line);border-radius:11px;overflow:auto}
table.matrix{width:100%;border-collapse:collapse;font-size:13px}
table.matrix th,table.matrix td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line)}
table.matrix th{background:var(--chip);font-weight:650;position:sticky;top:0;cursor:pointer;user-select:none}
table.matrix tr:hover td{background:var(--accent-soft)}
.num{font-family:var(--mono);text-align:right!important}
.log-box{background:#111312;color:#d4d4d0;font:12px/1.5 var(--mono);padding:12px;border-radius:10px;border:1px solid var(--line);height:68vh;overflow:auto;white-space:pre-wrap;word-break:break-all}
.log-err{color:#f87171;font-weight:600}
.log-new{color:#4ade80}
.log-info{color:#93c5fd}
</style></head><body>
<header><div class="wrap">
  <div class="top">
    <h1>Bangladesh news stream</h1>
    <span class="live"><span class="dot" id="dot"></span><span id="status">connecting…</span></span>
    <div class="tabs">
      <button class="tab active" id="tab-stream" onclick="setTab('stream')">📰 Stream & Inspector</button>
      <button class="tab" id="tab-matrix" onclick="setTab('matrix')">📊 Site Health Matrix</button>
      <button class="tab" id="tab-logs" onclick="setTab('logs')">🖥️ Live Scraper Logs</button>
    </div>
    <span class="sp"></span>
    <select id="day" title="Day"></select>
    <button id="pause" title="Pause/Resume live polling">Pause</button>
    <button id="export-btn" onclick="exportFiltered()" title="Download currently filtered articles as JSONL">⬇ Export JSONL</button>
  </div>

  <!-- Search, Sort & Debug Filters Toolbar -->
  <div class="toolbar" id="stream-toolbar">
    <div class="search-wrap">
      <input id="q" type="search" placeholder="Search headline, body, URL, area, keyword, author… (Press / to focus)">
      <button class="clear-btn" id="clear-q" title="Clear search" onclick="$('q').value='';render()">×</button>
    </div>
    <select id="sort" title="Sort by">
      <option value="updated">Sort: Latest updated</option>
      <option value="published">Sort: Latest published</option>
      <option value="ingested">Sort: Arrival (newest first)</option>
      <option value="ingested_asc">Sort: Arrival (oldest first)</option>
      <option value="words_desc">Sort: Word count (high → low)</option>
      <option value="words_asc">Sort: Word count (low → high / debug)</option>
      <option value="lag_desc">Sort: Ingestion lag (slowest first)</option>
      <option value="lag_asc">Sort: Ingestion lag (fastest first)</option>
    </select>
    <select id="lang" title="Language Filter">
      <option value="all">Lang: All (EN+BN)</option>
      <option value="en">English (EN)</option>
      <option value="bn">Bangla (BN)</option>
    </select>
    <select id="event" title="Disruption Event Filter">
      <option value="all">Events: All news</option>
      <option value="any_disruption">⚠️ All Disruptions</option>
      <option value="blockade">🚧 Blockade</option>
      <option value="strike">🛑 Strike / Hartal</option>
      <option value="procession">📢 Procession / Protest</option>
      <option value="clash">⚡ Clash / Violence</option>
      <option value="fire">🔥 Fire</option>
      <option value="waterlogging">🌊 Waterlogging / Flood</option>
      <option value="accident">💥 Accident</option>
      <option value="power_outage">🔌 Power / Gas Outage</option>
    </select>
    <select id="area" title="Matched Area / Location Filter">
      <option value="all">Area: All locations</option>
    </select>
    <select id="section" title="Section Filter">
      <option value="all">Section: All</option>
    </select>
    <select id="debug_filter" title="Debug & Data Quality Filter">
      <option value="all">Debug: All items</option>
      <option value="missing_body">🐛 Missing/short body (&lt;30w)</option>
      <option value="missing_pub">🐛 Missing published date</option>
      <option value="missing_upd">🐛 Missing updated date</option>
      <option value="has_dup">🔁 Cross-paper duplicates only</option>
      <option value="has_location">📍 Has matched location</option>
      <option value="no_location">❓ No location matched</option>
    </select>
    <label class="chk"><input id="nodup" type="checkbox"> hide duplicates</label>
    <label class="chk"><input id="debug_mode" type="checkbox" checked> debug badges</label>
    <button class="btn-sm" onclick="resetFilters()">Reset Filters</button>
  </div>

  <div class="stats-bar" id="stats"></div>
  <div class="chips-bar" id="chips"></div>
</div></header>

<main>
  <!-- TAB 1: Stream & Search Inspector -->
  <section class="panel active" id="panel-stream">
    <div id="list"></div>
  </section>

  <!-- TAB 2: Site Health & Debug Matrix -->
  <section class="panel" id="panel-matrix">
    <div style="margin-bottom:10px;display:flex;gap:10px;align-items:center">
      <input id="matrix-q" type="search" placeholder="Filter site name or key…" oninput="renderMatrix()">
      <span style="font-size:12.5px;color:var(--mute)">Click any newspaper row to filter the Stream view by that source.</span>
    </div>
    <div class="table-wrap">
      <table class="matrix" id="matrix-table">
        <thead>
          <tr>
            <th>Newspaper / Portal</th>
            <th>Key</th>
            <th>Lang</th>
            <th class="num">Emitted Today</th>
            <th class="num">Avg Words</th>
            <th class="num">Body OK %</th>
            <th class="num">Pub Date %</th>
            <th class="num">Disruptions</th>
            <th class="num">Seen: Today</th>
            <th class="num">Seen: Old</th>
            <th class="num">Seen: NoDate/Fail</th>
            <th>Last Ingested</th>
          </tr>
        </thead>
        <tbody id="matrix-body"></tbody>
      </table>
    </div>
  </section>

  <!-- TAB 3: Live Scraper Log Console -->
  <section class="panel" id="panel-logs">
    <div style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <input id="log-q" type="search" placeholder="Search log lines (e.g. Daily Sun, HTTP, round)…" oninput="renderLogs()" style="min-width:260px">
      <select id="log-level" onchange="renderLogs()">
        <option value="all">All log lines</option>
        <option value="err">⚠️ Warnings / Errors (!)</option>
        <option value="info">ℹ️ Round & Site Status (INFO)</option>
        <option value="new">🟢 Emitted Articles (NEW)</option>
      </select>
      <label class="chk"><input id="log-autoscroll" type="checkbox" checked> auto-scroll</label>
      <button class="btn-sm" onclick="pollDebug()">↻ Refresh Logs</button>
    </div>
    <div class="log-box" id="log-box">Loading scraper logs…</div>
  </section>
</main>

<script>
const $=id=>document.getElementById(id);
let day=null,todayStr=null,items=[],picked=new Set(),paused=false,lastNew=0,fresh=new Set();
let debugData={log_lines:[],seen_stats:{}},curTab='stream';
const MAX=400;

function setTab(t){
  curTab=t;
  ['stream','matrix','logs'].forEach(k=>{
    $('tab-'+k).className='tab'+(k===t?' active':'');
    $('panel-'+k).className='panel'+(k===t?' active':'');
  });
  $('stream-toolbar').style.display=(t==='stream'?'flex':'none');
  $('chips').style.display=(t==='stream'?'flex':'none');
  if(t==='matrix'||t==='logs')pollDebug();
}

function resetFilters(){
  $('q').value='';
  $('sort').value='updated';
  $('lang').value='all';
  $('event').value='all';
  $('area').value='all';
  $('section').value='all';
  $('debug_filter').value='all';
  $('nodup').checked=false;
  picked.clear();
  render();
}

function timeVal(ts){
  if(!ts)return 0;
  const t=Date.parse(ts);
  return isNaN(t)?0:t;
}

function lagMinutes(i){
  const pub=timeVal(i.published||i.updated),ing=timeVal(i.ingested_at);
  if(!pub||!ing)return null;
  return Math.round((ing-pub)/60000);
}

function fmtTime(iso,curDay){
  if(!iso)return '';
  if(iso.length<16)return iso;
  const d=iso.slice(0,10),t=iso.slice(11,16);
  return (d&&curDay&&d!==curDay)?(d.slice(5)+' '+t):t;
}

function escHtml(s){
  return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function highlightText(text,q){
  const safe=escHtml(text);
  if(!q||q.length<2)return safe;
  const escQ=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return safe.replace(new RegExp(`(${escQ})`,'gi'),'<mark>$1</mark>');
}

async function jget(u){const r=await fetch(u);if(!r.ok)throw new Error(r.status);return r.json()}

async function loadDays(){
  const d=await jget('/api/days');todayStr=d.today;
  const sel=$('day');const cur=day||todayStr;sel.innerHTML='';
  d.days.forEach(x=>{const o=document.createElement('option');o.value=x;o.textContent=x===todayStr?x+' (today)':x;sel.appendChild(o)});
  sel.value=cur;
  if(day===null){day=cur}
}

async function poll(){
  if(paused&&day===todayStr){return}
  try{
    const d=await jget('/api/items?date='+day+'&after='+items.length);
    if(d.total<items.length){items=[];}      // file was replaced
    if(d.items.length){
      d.items.forEach((i,idx)=>{i._seq=items.length+1;items.push(i);if(items.length>1)fresh.add(i.url)});
      lastNew=Date.now();
      render();
      if(curTab==='matrix')renderMatrix();
    }
    $('dot').className='dot'+(day===todayStr?'':' off');
    const t=new Date().toLocaleTimeString([], {hour12:false});
    $('status').textContent=(day===todayStr?'live · ':'archive · ')+items.length+' articles · checked '+t;
  }catch(e){$('dot').className='dot off';$('status').textContent='dashboard cannot reach the scraper'}
}

async function pollDebug(){
  if(!day)return;
  try{
    debugData=await jget('/api/debug?date='+day);
    if(curTab==='matrix')renderMatrix();
    if(curTab==='logs')renderLogs();
  }catch(e){}
}

function getFilteredItems(){
  const q=$('q').value.trim().toLowerCase(),nodup=$('nodup').checked;
  const langF=$('lang')?$('lang').value:'all';
  const evF=$('event')?$('event').value:'all';
  const activeArea=$('area')?$('area').value:'all';
  const activeSec=$('section')?$('section').value:'all';
  const dbgF=$('debug_filter')?$('debug_filter').value:'all';

  let shown=items.filter(i=>{
    if(picked.size&&!picked.has(i.source))return false;
    if(nodup&&i.duplicate_of)return false;
    if(langF!=='all'&&(i.lang||'en')!==langF)return false;
    if(evF==='any_disruption'&&!((i.event_types&&i.event_types.length)||i.is_disruption))return false;
    if(evF!=='all'&&evF!=='any_disruption'&&!(i.event_types||[]).includes(evF))return false;
    if(activeArea!=='all'&&!(i.locations||[]).includes(activeArea))return false;
    if(activeSec!=='all'&&(i.section||'-')!==activeSec)return false;
    const wc=i.word_count||(i.body?i.body.split(/\s+/).length:0);
    if(dbgF==='missing_body'&&wc>=30)return false;
    if(dbgF==='missing_pub'&&i.published)return false;
    if(dbgF==='missing_upd'&&i.updated)return false;
    if(dbgF==='has_dup'&&!i.duplicate_of)return false;
    if(dbgF==='has_location'&&!(i.locations&&i.locations.length))return false;
    if(dbgF==='no_location'&&(i.locations&&i.locations.length))return false;
    if(q){
      const hay=[i.headline,i.description,i.body,i.url,i.source,i.site_key,i.section,i.author,
                 (i.locations||[]).join(' '),(i.event_types||[]).join(' '),(i.keywords||[]).join(' ')].join(' ').toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });

  const sortMode=$('sort')?$('sort').value:'updated';
  shown.sort((a,b)=>{
    let diff=0;
    if(sortMode==='published'){
      diff=timeVal(b.published||b.updated||b.ingested_at)-timeVal(a.published||a.updated||a.ingested_at);
    }else if(sortMode==='ingested'){
      diff=timeVal(b.ingested_at)-timeVal(a.ingested_at)||(b._seq||0)-(a._seq||0);
    }else if(sortMode==='ingested_asc'){
      diff=timeVal(a.ingested_at)-timeVal(b.ingested_at)||(a._seq||0)-(b._seq||0);
    }else if(sortMode==='words_desc'){
      diff=(b.word_count||0)-(a.word_count||0);
    }else if(sortMode==='words_asc'){
      diff=(a.word_count||0)-(b.word_count||0);
    }else if(sortMode==='lag_desc'){
      diff=(lagMinutes(b)??-999999)-(lagMinutes(a)??-999999);
    }else if(sortMode==='lag_asc'){
      diff=(lagMinutes(a)??999999)-(lagMinutes(b)??999999);
    }else{ // 'updated'
      diff=timeVal(b.updated||b.published||b.ingested_at)-timeVal(a.updated||a.published||a.ingested_at);
    }
    if(diff!==0)return diff;
    return (timeVal(b.ingested_at)-timeVal(a.ingested_at))||0;
  });
  return shown;
}

function render(){
  const q=$('q').value.trim().toLowerCase();
  const dbgMode=$('debug_mode')?$('debug_mode').checked:true;
  const counts={},locCounts={},secCounts={};
  let enCnt=0,bnCnt=0,disCnt=0,wordSum=0,noBodyCnt=0,noPubCnt=0;

  items.forEach(i=>{
    counts[i.source]=(counts[i.source]||0)+1;
    if((i.lang||'en')==='bn')bnCnt++;else enCnt++;
    if((i.event_types&&i.event_types.length)||i.is_disruption)disCnt++;
    const wc=i.word_count||(i.body?i.body.split(/\s+/).length:0);
    wordSum+=wc;
    if(wc<30)noBodyCnt++;
    if(!i.published)noPubCnt++;
    (i.locations||[]).forEach(l=>{locCounts[l]=(locCounts[l]||0)+1});
    if(i.section&&i.section!=='-')secCounts[i.section]=(secCounts[i.section]||0)+1;
  });

  // Populate Area dropdown
  const areaSel=$('area');
  if(areaSel){
    const prev=areaSel.value;
    areaSel.innerHTML='<option value="all">Area: All locations ('+Object.keys(locCounts).length+')</option>';
    Object.keys(locCounts).sort((a,b)=>locCounts[b]-locCounts[a]).forEach(l=>{
      const o=document.createElement('option');o.value=l;o.textContent=`📍 ${l} (${locCounts[l]})`;areaSel.appendChild(o);
    });
    if(locCounts[prev])areaSel.value=prev;
  }

  // Populate Section dropdown
  const secSel=$('section');
  if(secSel){
    const prev=secSel.value;
    secSel.innerHTML='<option value="all">Section: All ('+Object.keys(secCounts).length+')</option>';
    Object.keys(secCounts).sort((a,b)=>secCounts[b]-secCounts[a]).slice(0,50).forEach(s=>{
      const o=document.createElement('option');o.value=s;o.textContent=`${s} (${secCounts[s]})`;secSel.appendChild(o);
    });
    if(secCounts[prev])secSel.value=prev;
  }

  const shown=getFilteredItems();

  // Stats Bar
  const stats=$('stats');
  if(stats){
    stats.innerHTML=
      `<span class="stat-pill">Showing: <b>${shown.length}</b> / <b>${items.length}</b></span>`+
      `<span class="stat-pill">Sources: <b>${Object.keys(counts).length}</b> (EN: <b>${enCnt}</b>, BN: <b>${bnCnt}</b>)</span>`+
      `<span class="stat-pill warn">⚠️ Disruptions: <b>${disCnt}</b></span>`+
      `<span class="stat-pill">📍 Tagged Areas: <b>${Object.keys(locCounts).length}</b></span>`+
      `<span class="stat-pill ok">Spark Corpus: <b>${wordSum.toLocaleString()}w</b></span>`+
      `<span class="stat-pill ${noBodyCnt?'warn':'ok'}" style="cursor:pointer" onclick="$('debug_filter').value='missing_body';render()" title="Click to filter missing/short body">🐛 Short/No Body: <b>${noBodyCnt}</b></span>`+
      `<span class="stat-pill ${noPubCnt?'warn':'ok'}" style="cursor:pointer" onclick="$('debug_filter').value='missing_pub';render()" title="Click to filter missing published date">🐛 No Pub Date: <b>${noPubCnt}</b></span>`;
  }

  // Source Chips
  const chips=$('chips');chips.innerHTML='';
  if(picked.size){
    const clr=document.createElement('span');clr.className='chip on';clr.textContent='✕ Clear source filter';
    clr.onclick=()=>{picked.clear();render()};chips.appendChild(clr);
  }
  Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).forEach(s=>{
    const c=document.createElement('span');c.className='chip'+(picked.has(s)?' on':'');
    c.textContent=s;const b=document.createElement('b');b.textContent=counts[s];c.appendChild(b);
    c.onclick=()=>{picked.has(s)?picked.delete(s):picked.add(s);render()};chips.appendChild(c)});

  // Render Cards
  const list=$('list');list.innerHTML='';
  const total=shown.length;
  const pageItems=shown.slice(0,MAX);
  if(!pageItems.length){
    const e=document.createElement('div');e.className='empty';
    e.textContent=items.length?'No articles match the current search / debug filters.':'Waiting for the first article of '+day+'…';
    list.appendChild(e);return;
  }

  pageItems.forEach(i=>{
    const isDis=(i.event_types&&i.event_types.length)||i.is_disruption;
    const wc=i.word_count||(i.body?i.body.split(/\s+/).length:0);
    const lag=lagMinutes(i);
    const el=document.createElement('article');
    el.className='item'+(isDis?' disruption':'')+(fresh.has(i.url)?' new':'');

    const m=document.createElement('div');m.className='meta';
    const add=(t,c,title)=>{const s=document.createElement('span');if(c)s.className=c;if(title)s.title=title;s.textContent=t;m.appendChild(s);return s};
    if(i._seq)add('#'+i._seq,'seq','Arrival sequence number in JSONL');
    add((i.ingested_at||'').slice(11,19),'','Ingested at '+(i.ingested_at||''));
    add((i.lang||'en').toUpperCase(),'lang');
    add(i.source,'src');
    if(i.site_key&&dbgMode)add('['+i.site_key+']','seq');
    if(i.section&&i.section!=='-')add(i.section,'dup');
    if(i.updated)add('updated '+fmtTime(i.updated,day),'upd','Updated: '+i.updated);
    if(i.published&&(!i.updated||i.published.slice(0,16)!==i.updated.slice(0,16)))add('published '+fmtTime(i.published,day),'','Published: '+i.published);
    if(i.author)add('by '+i.author);
    if(i.duplicate_of)add('also in '+i.duplicate_of,'dup');

    if(dbgMode){
      add(`body: ${wc}w`, wc>=50?'badge-ok':(wc>0?'badge-warn':'badge-err'), 'Extracted article body word count');
      if(!i.published)add('no-pub-date','badge-warn','Published timestamp missing');
      if(lag!==null&&lag>=0)add(`⏱️ lag: +${lag}m`, lag<=15?'badge-ok':'dup', 'Ingestion delay from publication');
    }

    (i.event_types||[]).forEach(ev=>add('⚠️ '+ev,'badge-ev'));
    (i.locations||[]).forEach(loc=>{
      const b=add('📍 '+loc,'badge-loc','Click to filter by '+loc);
      b.style.cursor='pointer';
      b.onclick=()=>{if($('area')){$('area').value=loc;render()}};
    });
    (i.time_windows||[]).forEach(tw=>add('🕒 '+tw,'dup'));
    el.appendChild(m);

    const a=document.createElement('a');a.className='hl';
    a.innerHTML=highlightText(i.headline,q);
    if(/^https?:\/\//.test(i.url)){a.href=i.url;a.target='_blank';a.rel='noopener noreferrer'}
    el.appendChild(a);

    if(i.description){
      const p=document.createElement('p');p.className='desc';
      const snippet=i.description.length>280?i.description.slice(0,280)+'…':i.description;
      p.innerHTML=highlightText(snippet,q);
      el.appendChild(p);
    }

    // Debug Row: URL + Expandable Full Text + Expandable Raw JSON Inspector
    if(dbgMode||(i.body&&i.body.length>80)){
      const drow=document.createElement('div');drow.className='debug-row';
      const uSpan=document.createElement('span');uSpan.className='url-mono';uSpan.textContent=i.url||'';
      drow.appendChild(uSpan);
      el.appendChild(drow);

      if(i.body&&i.body.length>0){
        const det=document.createElement('details');det.className='inspector';
        const sum=document.createElement('summary');
        sum.textContent=`📖 Read Full Body (${wc} words)`;
        const box=document.createElement('div');box.className='body-box';
        box.innerHTML=highlightText(i.body,q);
        det.appendChild(sum);det.appendChild(box);el.appendChild(det);
      }

      if(dbgMode){
        const jdet=document.createElement('details');jdet.className='inspector';
        const jsum=document.createElement('summary');
        jsum.textContent='{ } Inspect Raw JSON';
        const jbox=document.createElement('div');jbox.className='json-box';
        const cleanObj=Object.assign({},i);delete cleanObj._seq;
        jbox.textContent=JSON.stringify(cleanObj,null,2);
        const cbtn=document.createElement('button');cbtn.className='btn-sm';cbtn.style.marginBottom='6px';
        cbtn.textContent='📋 Copy JSON';
        cbtn.onclick=()=>{navigator.clipboard.writeText(JSON.stringify(cleanObj,null,2));cbtn.textContent='✓ Copied!'};
        jdet.appendChild(jsum);jdet.appendChild(cbtn);jdet.appendChild(jbox);el.appendChild(jdet);
      }
    }

    list.appendChild(el);
  });

  if(total>MAX){
    const e=document.createElement('div');e.className='empty';
    e.textContent='Showing the first '+MAX+' of '+total+' matching articles';
    list.appendChild(e);
  }
  setTimeout(()=>fresh.clear(),4000);
}

function renderMatrix(){
  const tbody=$('matrix-body');if(!tbody)return;
  const mq=($('matrix-q')?$('matrix-q').value:'').trim().toLowerCase();
  const bySource={};
  items.forEach(i=>{
    const s=bySource[i.source]||(bySource[i.source]={
      source:i.source,site_key:i.site_key||'',lang:(i.lang||'en').toUpperCase(),
      count:0,words:0,bodyOk:0,pubOk:0,disruptions:0,lastIngested:''
    });
    s.count++;
    const wc=i.word_count||(i.body?i.body.split(/\s+/).length:0);
    s.words+=wc;
    if(wc>=30)s.bodyOk++;
    if(i.published)s.pubOk++;
    if((i.event_types&&i.event_types.length)||i.is_disruption)s.disruptions++;
    if((i.ingested_at||'')>s.lastIngested)s.lastIngested=i.ingested_at||'';
  });

  const rows=Object.values(bySource).filter(r=>!mq||(r.source+' '+r.site_key).toLowerCase().includes(mq));
  rows.sort((a,b)=>b.count-a.count);
  tbody.innerHTML='';
  rows.forEach(r=>{
    const seen=debugData.seen_stats[r.site_key]||{};
    const sToday=seen.today||0,sOld=seen.old||0,sFail=(seen.nodate||0)+(seen.failed||0)+(seen.unparsed||0);
    const avgW=r.count?Math.round(r.words/r.count):0;
    const bodyPct=r.count?Math.round((r.bodyOk/r.count)*100):0;
    const pubPct=r.count?Math.round((r.pubOk/r.count)*100):0;
    const tr=document.createElement('tr');
    tr.style.cursor='pointer';
    tr.onclick=()=>{picked.clear();picked.add(r.source);setTab('stream');render()};
    tr.innerHTML=
      `<td><b>${escHtml(r.source)}</b></td>`+
      `<td class="num">${escHtml(r.site_key||'-')}</td>`+
      `<td><span class="lang">${escHtml(r.lang)}</span></td>`+
      `<td class="num"><b>${r.count}</b></td>`+
      `<td class="num">${avgW}w</td>`+
      `<td class="num"><span class="${bodyPct>=80?'badge-ok':'badge-warn'}">${bodyPct}%</span></td>`+
      `<td class="num"><span class="${pubPct>=80?'badge-ok':'badge-warn'}">${pubPct}%</span></td>`+
      `<td class="num">${r.disruptions}</td>`+
      `<td class="num">${sToday}</td>`+
      `<td class="num">${sOld}</td>`+
      `<td class="num">${sFail?`<span class="badge-err">${sFail}</span>`:'0'}</td>`+
      `<td class="num">${escHtml(r.lastIngested.slice(11,19)||'-')}</td>`;
    tbody.appendChild(tr);
  });
}

function renderLogs(){
  const box=$('log-box');if(!box)return;
  const lq=($('log-q')?$('log-q').value:'').trim().toLowerCase();
  const lv=$('log-level')?$('log-level').value:'all';
  const lines=(debugData.log_lines||[]).filter(ln=>{
    if(lv==='err'&&!ln.includes('! ')&&!ln.includes('? '))return false;
    if(lv==='info'&&!ln.includes('INFO |'))return false;
    if(lv==='new'&&!ln.includes('NEW |'))return false;
    if(lq&&!ln.toLowerCase().includes(lq))return false;
    return true;
  });
  if(!lines.length){box.textContent='No matching log lines in news_stream_'+day+'.log';return}
  box.innerHTML=lines.map(ln=>{
    const s=escHtml(ln);
    if(ln.includes('! ')||ln.includes('? '))return `<span class="log-err">${s}</span>`;
    if(ln.includes('NEW |'))return `<span class="log-new">${s}</span>`;
    if(ln.includes('INFO | -- round'))return `<span class="log-info">${s}</span>`;
    return s;
  }).join('\n');
  if($('log-autoscroll')&&$('log-autoscroll').checked)box.scrollTop=box.scrollHeight;
}

function exportFiltered(){
  const shown=getFilteredItems();
  const blob=new Blob([shown.map(i=>{const c=Object.assign({},i);delete c._seq;return JSON.stringify(c)}).join('\n')+'\n'],{type:'application/x-ndjson'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`news_stream_${day}_filtered_${shown.length}.jsonl`;
  a.click();
}

// Keyboard shortcut '/' to focus search
document.addEventListener('keydown',e=>{
  if(e.key==='/'&&document.activeElement!==$('q')&&document.activeElement.tagName!=='INPUT'){
    e.preventDefault();$('q').focus();
  }
});

['q','nodup','sort','lang','event','area','section','debug_filter','debug_mode'].forEach(id=>{
  if($(id))$(id).oninput=$(id).onchange=render;
});
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';if(!paused)poll()};
$('day').onchange=()=>{day=$('day').value;items=[];picked.clear();fresh.clear();render();poll();pollDebug()};

(async()=>{await loadDays();await poll();await pollDebug();setInterval(poll,3000);setInterval(pollDebug,8000);setInterval(loadDays,60000)})();
</script></body></html>
"""


def main():
    p = argparse.ArgumentParser(description="Dashboard for the live news stream")
    p.add_argument("--logs", default="logs", help="folder holding news_stream_YYYY-MM-DD.jsonl (default: logs)")
    p.add_argument("--port", type=int, default=8765)
    a = p.parse_args()
    srv = serve(Path(a.logs), a.port)
    print(f"Dashboard on http://127.0.0.1:{a.port}  (reading {Path(a.logs).resolve()}). Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
