#!/usr/bin/env python3
"""
Live dashboard for the news stream
----------------------------------
A tiny local web page (standard library only, nothing to install) that shows the
articles written by live_news_stream.py as they arrive.

  * reads logs/news_stream_YYYY-MM-DD.jsonl (one file per Dhaka day)
  * new articles appear by themselves every few seconds
  * filter by newspaper, search headlines, hide cross-paper duplicates
  * a day picker to look back at earlier days' logs

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
:root{--bg:#f6f5f1;--card:#fff;--ink:#1b1b1a;--mute:#6b6a65;--line:#e4e2da;--accent:#0b6b4f;--chip:#ecebe4;--hot:#fff4c9}
@media (prefers-color-scheme:dark){:root{--bg:#161715;--card:#202220;--ink:#ecebe6;--mute:#9a988f;--line:#303230;--accent:#4fc59a;--chip:#2a2c2a;--hot:#3b3820}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px}
.top{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;max-width:980px;margin:0 auto}
h1{font-size:18px;margin:0;font-weight:650}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--mute);font-size:13px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:p 1.6s infinite}
.dot.off{background:var(--mute);animation:none}
@keyframes p{50%{opacity:.25}}
.sp{flex:1}
input,select,button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
input[type=search]{min-width:200px}
button{cursor:pointer}
label.chk{display:inline-flex;gap:6px;align-items:center;color:var(--mute);font-size:13px}
.chips{max-width:980px;margin:10px auto 0;display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--line);background:var(--chip);border-radius:999px;padding:3px 10px;font-size:13px;cursor:pointer;user-select:none}
.chip b{font-weight:650;margin-left:4px}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
main{max-width:980px;margin:14px auto 60px;padding:0 16px}
.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.item.new{animation:flash 4s ease-out}
@keyframes flash{from{background:var(--hot)}to{background:var(--card)}}
.meta{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12.5px;color:var(--mute);align-items:center}
.src{font-weight:650;color:var(--accent)}
.dup{border:1px solid var(--line);border-radius:6px;padding:0 6px;font-size:12px}
.upd{color:var(--accent);font-weight:600}
.hl{display:block;margin:4px 0 2px;font-size:16.5px;font-weight:600;color:var(--ink);text-decoration:none}
.hl:hover{text-decoration:underline}
.desc{color:var(--mute);font-size:14px;margin:2px 0 0}
.empty{text-align:center;color:var(--mute);padding:60px 0}
</style></head><body>
<header><div class="top">
  <h1>Bangladesh news stream</h1>
  <span class="live"><span class="dot" id="dot"></span><span id="status">connecting…</span></span>
  <span class="sp"></span>
  <select id="day" title="Day"></select>
  <select id="sort" title="Sort by">
    <option value="updated">Latest updated</option>
    <option value="published">Latest published</option>
    <option value="ingested">Arrival order</option>
  </select>
  <input id="q" type="search" placeholder="Search headlines…">
  <label class="chk"><input id="nodup" type="checkbox"> hide duplicates</label>
  <button id="pause">Pause</button>
</div><div class="chips" id="chips"></div></header>
<main><div id="list"></div></main>
<script>
const $=id=>document.getElementById(id);
let day=null,todayStr=null,items=[],picked=new Set(),paused=false,lastNew=0,fresh=new Set();
const MAX=400;

function timeVal(ts){
  if(!ts)return 0;
  const t=Date.parse(ts);
  return isNaN(t)?0:t;
}

function fmtTime(iso,curDay){
  if(!iso)return '';
  if(iso.length<16)return iso;
  const d=iso.slice(0,10),t=iso.slice(11,16);
  return (d&&curDay&&d!==curDay)?(d.slice(5)+' '+t):t;
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
    if(d.items.length){d.items.forEach(i=>{items.push(i);if(items.length>1)fresh.add(i.url)});lastNew=Date.now();render()}
    $('dot').className='dot'+(day===todayStr?'':' off');
    const t=new Date().toLocaleTimeString([], {hour12:false});
    $('status').textContent=(day===todayStr?'live · ':'archive · ')+items.length+' articles · checked '+t;
  }catch(e){$('dot').className='dot off';$('status').textContent='dashboard cannot reach the scraper'}
}

function render(){
  const q=$('q').value.trim().toLowerCase(),nodup=$('nodup').checked;
  const counts={};items.forEach(i=>counts[i.source]=(counts[i.source]||0)+1);
  const chips=$('chips');chips.innerHTML='';
  Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).forEach(s=>{
    const c=document.createElement('span');c.className='chip'+(picked.has(s)?' on':'');
    c.textContent=s;const b=document.createElement('b');b.textContent=counts[s];c.appendChild(b);
    c.onclick=()=>{picked.has(s)?picked.delete(s):picked.add(s);render()};chips.appendChild(c)});
  const list=$('list');list.innerHTML='';
  let shown=items.filter(i=>(!picked.size||picked.has(i.source))&&(!nodup||!i.duplicate_of)
    &&(!q||(i.headline+' '+(i.description||'')).toLowerCase().includes(q)));
  const sortMode=$('sort')?$('sort').value:'updated';
  shown.sort((a,b)=>{
    let diff=0;
    if(sortMode==='published'){
      diff=timeVal(b.published||b.updated||b.ingested_at)-timeVal(a.published||a.updated||a.ingested_at);
    }else if(sortMode==='ingested'){
      diff=timeVal(b.ingested_at)-timeVal(a.ingested_at);
    }else{ // 'updated'
      diff=timeVal(b.updated||b.published||b.ingested_at)-timeVal(a.updated||a.published||a.ingested_at);
    }
    if(diff!==0)return diff;
    return (timeVal(b.ingested_at)-timeVal(a.ingested_at))||0;
  });
  const total=shown.length;shown=shown.slice(0,MAX);
  if(!shown.length){const e=document.createElement('div');e.className='empty';
    e.textContent=items.length?'No articles match the filters.':'Waiting for the first article of '+day+'…';list.appendChild(e);return}
  shown.forEach(i=>{
    const el=document.createElement('article');el.className='item'+(fresh.has(i.url)?' new':'');
    const m=document.createElement('div');m.className='meta';
    const add=(t,c)=>{const s=document.createElement('span');if(c)s.className=c;s.textContent=t;m.appendChild(s);return s};
    add((i.ingested_at||'').slice(11,19));add(i.source,'src');if(i.section&&i.section!=='-')add(i.section);
    if(i.updated)add('updated '+fmtTime(i.updated,day),'upd');
    if(i.published&&(!i.updated||i.published.slice(0,16)!==i.updated.slice(0,16)))add('published '+fmtTime(i.published,day));
    if(i.author)add('by '+i.author);
    if(i.duplicate_of)add('also in '+i.duplicate_of,'dup');
    el.appendChild(m);
    const a=document.createElement('a');a.className='hl';a.textContent=i.headline;
    if(/^https?:\/\//.test(i.url)){a.href=i.url;a.target='_blank';a.rel='noopener noreferrer'}el.appendChild(a);
    if(i.description){const p=document.createElement('p');p.className='desc';
      p.textContent=i.description.length>220?i.description.slice(0,220)+'…':i.description;el.appendChild(p)}
    list.appendChild(el)});
  if(total>MAX){const e=document.createElement('div');e.className='empty';e.textContent='Showing the newest '+MAX+' of '+total;list.appendChild(e)}
  setTimeout(()=>fresh.clear(),4000);
}

$('q').oninput=render;$('nodup').onchange=render;$('sort').onchange=render;
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';if(!paused)poll()};
$('day').onchange=()=>{day=$('day').value;items=[];picked.clear();fresh.clear();render();poll()};

(async()=>{await loadDays();await poll();setInterval(poll,3000);setInterval(loadDays,60000)})();
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
