# Backend Server Deployment, SSH Dependency Install & Operations Guide

This guide covers deploying and updating the **BigWarn Backend** on your Ubuntu 24.04 LTS production VM (`asifdev777@172.198.62.94`), installing new Python packages via SSH, managing `systemd` services, and operating the Cloudflare HTTPS tunnel and 48-hour R2 archiver.

---

## 1. Quickest Update: One-Command Deploy ([deploy.sh](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/deploy.sh))

Whenever you modify code inside `real-time-alert/backend/` or add dependencies to [backend/requirements.txt](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/requirements.txt), run this single command from your Mac terminal:

```bash
/Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/deploy.sh asifdev777@172.198.62.94 ~/Downloads/bigwarn-vm_key.pem
```

What `deploy.sh` does automatically:
1. Syncs `backend/` to `~/real-time-alert/backend` on the VM via `rsync` (while preserving live `data/logs/*`, `data/seen_urls.json`, and `lakehouse/storage/*`).
2. Installs/updates all Python packages in `requirements.txt` on the VM (`pip3 install -r ~/real-time-alert/backend/requirements.txt --break-system-packages`).
3. Restarts `bigwarn-scraper` and `bigwarn-api` and prints their live `systemd` status.

---

## 2. Manual Step-by-Step SSH Deployment & Dependency Installation

### Step 2.1 — Sync Backend Files via `rsync`
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
```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "pip3 install -r ~/real-time-alert/backend/requirements.txt --break-system-packages"
```

### Step 2.3 — Clear Stale Caches & Restart Services
```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "rm -f ~/real-time-alert/backend/data/dynamic_locations_cache.json && sudo systemctl restart bigwarn-scraper bigwarn-api"
```

---

## 3. First-Time Ubuntu VM Provisioning (`setup_azure_prod.sh`)

On a brand-new Ubuntu 24.04 LTS VM:
1. Lock your SSH key permissions on macOS:
   ```bash
   chmod 400 ~/Downloads/bigwarn-vm_key.pem
   ```
2. Upload `backend/` and run [setup_azure_prod.sh](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/setup_azure_prod.sh):
   ```bash
   ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 "mkdir -p ~/real-time-alert"
   /Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/deploy.sh asifdev777@172.198.62.94 ~/Downloads/bigwarn-vm_key.pem
   ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 "bash ~/real-time-alert/backend/setup_azure_prod.sh"
   ```
   This configures three auto-restarting `systemd` units:
   - `bigwarn-scraper.service` (`run_streamer.py`)
   - `bigwarn-api.service` (`run_api.py --host 127.0.0.1 --port 8765`)
   - `bigwarn-tunnel.service` (`cloudflared tunnel --url http://127.0.0.1:8765`)

---

## 4. Service Monitoring, Logs & Cloudflare Tunnel Commands

### Check Status of All 3 Services
```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "sudo systemctl status bigwarn-scraper bigwarn-api bigwarn-tunnel --no-pager"
```

### Inspect Live Logs (`journalctl`)
```bash
# View last 60 lines of API server logs
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "sudo journalctl -u bigwarn-api -n 60 --no-pager"

# Follow live 45-portal scraper output
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "sudo journalctl -u bigwarn-scraper -f"
```

### Get Current Cloudflare HTTPS Tunnel URL
```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "sudo journalctl -u bigwarn-tunnel -n 50 --no-pager | grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' | tail -n 1"
```
Copy the printed `https://*.trycloudflare.com` URL into:
- `BIGWARN_FEED_URL` in [frontend/.env.local](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/frontend/.env.local) (and Vercel Environment Variables)
- `EXPO_PUBLIC_BIGWARN_FEED_URL` in [mobile/.env](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/mobile/.env)

---

## 5. Environment Variables & 48-Hour Cloudflare R2 Archival

- Configure [backend/.env](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/.env) with:
  - `BIGWARN_FEED_TOKEN` (must match `frontend/.env.local` and `mobile/.env`)
  - `BIGWARN_LOG_RETENTION_HOURS=48`
  - Cloudflare R2 credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT_URL`, `S3_LAKEHOUSE_BUCKET`)
- The background R2 archive worker ([r2_archive_service.py](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend/app/services/r2_archive_service.py)) runs hourly inside `bigwarn-api`, keeping the active 48-hour hot window on local VM disk while archiving completed daily JSONL/log/Gold files to Cloudflare R2.
