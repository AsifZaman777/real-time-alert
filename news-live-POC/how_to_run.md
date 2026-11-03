# How to Run the Bangladesh Super News Streamer & Debug Dashboard

## 1. Quick Start Commands

```powershell
cd f:\real-time-alert\news-live-POC

# List all 45 configured English (15) & Bangla (30) portals
python live_news_stream.py --list-sites

# Run the Super Streamer + Live Debug Dashboard (open http://127.0.0.1:8765)
python live_news_stream.py --ui

# Run the Dashboard standalone to inspect/search/sort existing logs
python news_dashboard.py --logs logs --port 8765
```

## 2. Filtering & Debugging CLI Options

```powershell
# Stream only Bangla portals (30 sources) or only English portals (15 sources)
python live_news_stream.py --lang bn --ui
python live_news_stream.py --lang en --ui

# Stream specific portals only (comma-separated keys from --list-sites)
python live_news_stream.py --sites prothomalo,prothomalo_bn,thedailystar,jugantor,samakal,dhakapost --ui

# Health-check live URL rules, date extraction, and body/disruption parsing on all or selected sites
python live_news_stream.py --sites unb,observerbd,prothomalo_bn,jugantor --check

# Run a single round with verbose debug output and stop
python live_news_stream.py --once --verbose --ui
```

## 3. Debug-Friendly UI Features (`http://127.0.0.1:8765`)

1. **📰 Stream & Inspector Tab**:
   - **Instant Search (`/` shortcut)**: Searches across headline, summary, full article body, URL, `site_key`, section, author, matched locations, and event tags with live `<mark>` keyword highlighting.
   - **8 Sort Modes**:
     - *Latest updated* / *Latest published*
     - *Arrival (newest first / oldest first)*
     - *Word count (high → low / low → high)* — sort low → high to immediately spot articles with short or missing bodies
     - *Ingestion lag (slowest / fastest)* — inspect the delay (`⏱️ lag: +Xm`) between article publication and ingestion
   - **Debug Quality Filters**:
     - `🐛 Missing/short body (<30w)`
     - `🐛 Missing published date`
     - `🐛 Missing updated date`
     - `🔁 Cross-paper duplicates only`
     - `📍 Has matched location` / `❓ No location matched`
   - **Per-Card Inspector**:
     - Sequence badge (`#1`, `#2`, ...), `[site_key]`, `body: Nw` health badge, and `⏱️ lag` badge
     - `📖 Read Full Body` expandable text viewer
     - `{ } Inspect Raw JSON` + `📋 Copy JSON` button to inspect the exact Spark JSONL payload
   - **⬇ Export JSONL**: Download the currently searched/filtered slice directly as a `.jsonl` file.
2. **📊 Site Health Matrix Tab**:
   - Shows per-portal statistics: Articles emitted today, average word count, `% Body OK`, `% Pub Date OK`, disruption count, and `seen_urls.json` counts (`today`, `old`, `nodate/failed`). Click any row to filter the stream by that newspaper.
3. **🖥️ Live Scraper Logs Tab**:
   - Real-time tail of `logs/news_stream_YYYY-MM-DD.log` with search and level filters (`⚠️ Warnings/Errors`, `ℹ️ Round Status`, `🟢 Emitted Articles`).
