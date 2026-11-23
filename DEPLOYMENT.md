# BigWarn — Server Setup, Deployment & Operations Guide

This guide covers end-to-end production setup for the **BigWarn Backend** (45-portal scraper, Medallion ELT API, 48-hour Cloudflare R2 archiver, and Cloudflare HTTPS Tunnel) on an Ubuntu cloud VM (such as **Azure for Students**), plus connecting the **Next.js Frontend** and **React Native Mobile App**.

---

## 1. Environment Variables (Keep Secrets Out of Git)

All `.env` / `.env.local` files are gitignored. Use the `.env.example` templates in each folder:

| Component | File | Purpose |
| :--- | :--- | :--- |
| **Backend** | `backend/.env` | Cloudflare R2 credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT_URL`, `S3_LAKEHOUSE_BUCKET`), `BIGWARN_LOG_RETENTION_HOURS=48`, and `BIGWARN_FEED_TOKEN`. |
| **Frontend** | `frontend/.env.local` | Server-side proxy target `BIGWARN_FEED_URL` and `BIGWARN_FEED_TOKEN` (never exposed to browser). |
| **Mobile** | `mobile/.env` | `EXPO_PUBLIC_BIGWARN_FEED_URL` and `EXPO_PUBLIC_BIGWARN_FEED_TOKEN`. |

> Keep `BIGWARN_FEED_TOKEN` identical across `backend/.env`, `frontend/.env.local`, and `mobile/.env` to protect `/api/v1/alerts/*` and `/api/v1/stream/*` with Bearer token authentication.

---

## 2. Cloud VM Provisioning (Azure for Students)

1. In Azure Portal → **Create a virtual machine**:
   - **Region:** Choose a region allowed by your student subscription (check via Cloud Shell: `az policy assignment list --query "[].parameters.listOfAllowedLocations.value"`).
   - **Image:** `Ubuntu Server 24.04 LTS - x64 Gen2`
   - **Size:** `Standard_B2als_v2` (2 vCPU, 4 GB RAM) or `Standard_B1s`
   - **Inbound ports:** Allow **`SSH (22)`** only. *(Port `8765` does **not** need to be opened publicly because `cloudflared` tunnels `127.0.0.1:8765` over HTTPS.)*
2. Download the `.pem` key and lock its permissions on your Mac:
   ```bash
   chmod 400 ~/Downloads/bigwarn-vm_key.pem
   ```

---

## 3. First-Time Upload & 24/7 Production Setup

1. **Upload only `backend/`** (excluding macOS `.DS_Store` and `__pycache__`):
   ```bash
   ssh -i ~/Downloads/bigwarn-vm_key.pem <USER>@<VM_IP> "mkdir -p ~/real-time-alert"
   rsync -avz --exclude='.DS_Store' --exclude='__pycache__' --exclude='*.pyc' \
     -e "ssh -i ~/Downloads/bigwarn-vm_key.pem" \
     /Users/sabihakhairohi/Projects/news-alert/real-time-alert/backend \
     <USER>@<VM_IP>:~/real-time-alert/
   ```

2. **Run the one-time setup script** (`backend/setup_azure_prod.sh`):
   ```bash
   ssh -i ~/Downloads/bigwarn-vm_key.pem <USER>@<VM_IP> "bash ~/real-time-alert/backend/setup_azure_prod.sh"
   ```
   This installs Python dependencies and `cloudflared`, and creates 3 auto-restarting `systemd` services:
   - `bigwarn-scraper` (`run_streamer.py`)
   - `bigwarn-api` (`run_api.py --host 127.0.0.1 --port 8765`)
   - `bigwarn-tunnel` (`cloudflared tunnel --url http://127.0.0.1:8765`)

3. Copy the `https://....trycloudflare.com` URL printed at the end into:
   - `BIGWARN_FEED_URL` in `frontend/.env.local` (and Vercel Environment Variables)
   - `EXPO_PUBLIC_BIGWARN_FEED_URL` in `mobile/.env`

---

## 4. Deploying Backend Code Updates & Downloading New Dependencies on the Server

Whenever you update code inside `backend/` or add new packages to `backend/requirements.txt` (such as `h3`, `scikit-learn`, `numpy`, `lxml`), use `backend/deploy.sh`. It automatically syncs `backend/` via `rsync`, runs `pip3 install -r ~/real-time-alert/backend/requirements.txt --break-system-packages` on the server, and restarts `bigwarn-scraper` and `bigwarn-api`:

```bash
./real-time-alert/backend/deploy.sh asifdev777@172.198.62.94 ~/Downloads/bigwarn-vm_key.pem
```

To manually download/install new Python dependencies on the VM via SSH at any time:

```bash
ssh -i ~/Downloads/bigwarn-vm_key.pem asifdev777@172.198.62.94 \
  "pip3 install -r ~/real-time-alert/backend/requirements.txt --break-system-packages && sudo systemctl restart bigwarn-scraper bigwarn-api"
```

*(See [SERVER_DEPLOY_AND_UPDATE_GUIDE.md](file:///Users/sabihakhairohi/Projects/news-alert/real-time-alert/SERVER_DEPLOY_AND_UPDATE_GUIDE.md) for the full SSH operations & troubleshooting reference.)*

---

## 5. Useful Server Commands & Health Checks

Run these over SSH on your VM:

```bash
# Check status of all 3 services
sudo systemctl status bigwarn-scraper bigwarn-api bigwarn-tunnel --no-pager

# View live logs
journalctl -u bigwarn-api -f
journalctl -u bigwarn-scraper -f

# Get current Cloudflare HTTPS tunnel URL
journalctl -u bigwarn-tunnel -n 50 --no-pager | grep -oE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" | tail -n 1

# Restart services
sudo systemctl restart bigwarn-scraper bigwarn-api bigwarn-tunnel
```

Verify API & R2 archive status:
- `GET https://<YOUR_TUNNEL_URL>/api/v1/health`
- `GET https://<YOUR_TUNNEL_URL>/api/v1/archive/status` (requires `Authorization: Bearer <BIGWARN_FEED_TOKEN>` if token is set)

---

## 6. 48-Hour Rolling Logs & Cloudflare R2 Archival

- `run_streamer.py` rotates daily 24-hour files (`news_stream_YYYY-MM-DD.jsonl` and `.log`) in `backend/data/logs/`.
- The background R2 archiver (`backend/app/services/r2_archive_service.py`) runs every hour inside `bigwarn-api`:
  - Keeps **today** and **yesterday** (**48-hour hot window**) on local VM disk.
  - Backs up yesterday's completed 24-hour file to Cloudflare R2 under `logs/YYYY/MM/DD/`.
  - Uploads any file older than 48 hours to Cloudflare R2 (along with `gold/YYYY/MM/DD/gold_alerts_YYYY-MM-DD.json`) and deletes the expired local file after R2 confirms `HTTP 2xx`.
- Dry-run check anytime:
  ```bash
  cd ~/real-time-alert
  python3 -m backend.app.services.r2_archive_service --dry-run
  ```

---

## 7. Running Frontend & Mobile App

- **Next.js Frontend (Vercel or local):**
  ```bash
  cd real-time-alert/frontend
  npm install && npm run dev
  ```
- **React Native Mobile App (Expo Go, Node 22+):**
  ```bash
  cd real-time-alert/mobile
  npm install && npx expo start -c
  ```
