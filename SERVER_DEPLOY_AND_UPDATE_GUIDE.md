# BigWarn — Backend Server Update, SSH Dependency Install & Deployment Guide

This guide provides copy-paste commands for deploying backend updates from your Mac to your Ubuntu production VM (`asifdev777@172.198.62.94`), downloading/installing new Python dependencies (`h3`, `scikit-learn`, `numpy`, `lxml`, etc.) on the server via SSH, and verifying the `systemd` services.

---

## 1. Quickest Way: One-Command Deploy (`deploy.sh`)

[backend/deploy.sh](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/deploy.sh) automatically:
1. Syncs your local `backend/` code to `~/real-time-alert/backend` on the VM via `rsync` (while preserving the server's live `data/logs/*`, `data/seen_urls.json`, and `lakehouse/storage/*`).
2. Runs `pip3 install -r ~/real-time-alert/backend/requirements.txt --break-system-packages` on the server to download any newly added dependencies.
3. Restarts `bigwarn-scraper` and `bigwarn-api`.

Run this single command from your Mac terminal:

```bash
/Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/deploy.sh asifdev777@172.198.62.94 ~/Downloads/bigwarn-vm_key.pem
```

---

## 2. Step-by-Step Manual Update & SSH Dependency Installation

If you prefer running each step manually:

### Step 2.1 — Sync Updated Backend Code from Mac to Server
```bash
rsync -avz --delete \
  --exclude='.DS_Store' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='data/logs/*' \
  --exclude='data/seen_urls.json' \
  --exclude='data/dynamic_locations_cache.json' \
  --exclude='lakehouse/storage/*' \
  -e "ssh -i ~/Downloads/bigwarn-vm_key.pem" \
  /Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend \
  asifdev777@172.198.62.94:~/real-time-alert/
```

### Step 2.2 — Download & Install Python Dependencies on the Server via SSH
To install everything listed in [backend/requirements.txt](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/requirements.txt) (`requests`, `beautifulsoup4`, `lxml`, `boto3`, `numpy`, `scikit-learn`, `h3`):

```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "pip3 install -r ~/real-time-alert/backend/requirements.txt --break-system-packages"
```

Or to install specific new packages directly on the server:
```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "pip3 install h3 scikit-learn numpy lxml --break-system-packages"
```

*(Note: On Ubuntu 24.04 LTS, `--break-system-packages` is required when installing pip packages into `/usr/bin/python3` for `systemd` services.)*

### Step 2.3 — Clean Stale Location Cache & Restart `systemd` Services
Whenever you update place taxonomy rules (`TAG_VERSION`) or crowd telemetry logic, remove any old cached dynamic location files on the VM and restart the services:

```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "rm -f ~/real-time-alert/backend/data/dynamic_locations_cache.json ~/real-time-alert/backend/data/crowd_signals.json && sudo systemctl restart bigwarn-scraper bigwarn-api"
```

---

## 3. Verifying Services & Live Logs over SSH

### 3.1 Check Service Status
```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "sudo systemctl status bigwarn-scraper bigwarn-api bigwarn-tunnel --no-pager"
```

### 3.2 Tail Live API or Scraper Logs (Troubleshooting Crashes)
If `bigwarn-api` or `bigwarn-scraper` ever shows `exit-code` / `FAILURE`, view the exact Python traceback with `journalctl`:

```bash
# View last 60 lines of API service logs
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "sudo journalctl -u bigwarn-api -n 60 --no-pager"

# Stream live scraper output
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "sudo journalctl -u bigwarn-scraper -f"
```

### 3.3 Check the Active Cloudflare HTTPS Tunnel URL
If `bigwarn-tunnel` restarts or the VM reboots, retrieve the active `https://*.trycloudflare.com` URL:

```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "sudo journalctl -u bigwarn-tunnel -n 50 --no-pager | grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' | tail -n 1"
```

### 3.4 Test the Live API Health & H3 Crowd Telemetry Endpoint
```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "curl -s http://127.0.0.1:8765/api/v1/health"
```

---

## 4. Rebuilding the Mobile Android APK After UI or Tunnel Updates

Whenever you change mobile UI code in `real-time-alert/mobile/` or update `EXPO_PUBLIC_BIGWARN_FEED_URL` in [mobile/.env](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/.env), rebuild and publish the updated APK to `frontend/public/downloads/bigwarn-edge.apk`:

```bash
/Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/build_apk.sh
```
