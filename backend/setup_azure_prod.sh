#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(whoami)"

echo "==> Installing system packages & Python dependencies..."
sudo apt-get update -y
sudo apt-get install -y python3-pip curl
pip3 install -r "$APP_DIR/requirements.txt" --break-system-packages

echo "==> Installing cloudflared for free HTTPS tunnel..."
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(dpkg --print-architecture)"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o /tmp/cloudflared.deb
  sudo dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
fi

echo "==> Creating systemd services for 24/7 auto-restart..."
sudo tee /etc/systemd/system/bigwarn-scraper.service >/dev/null <<EOF
[Unit]
Description=BigWarn 45-Portal News Scraper
After=network-online.target

[Service]
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/python3 ${APP_DIR}/run_streamer.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/bigwarn-api.service >/dev/null <<EOF
[Unit]
Description=BigWarn Headless REST & SSE API
After=network-online.target

[Service]
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/python3 ${APP_DIR}/run_api.py --host 127.0.0.1 --port 8765
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/bigwarn-tunnel.service >/dev/null <<EOF
[Unit]
Description=BigWarn Cloudflare HTTPS Tunnel
After=bigwarn-api.service

[Service]
User=${USER_NAME}
ExecStart=/usr/bin/cloudflared tunnel --url http://127.0.0.1:8765
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now bigwarn-scraper bigwarn-api bigwarn-tunnel

echo "==> Done! Checking HTTPS tunnel URL..."
sleep 4
journalctl -u bigwarn-tunnel -n 30 --no-pager | grep -oE "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" | tail -n 1 || true
