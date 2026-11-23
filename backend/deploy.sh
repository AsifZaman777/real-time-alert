#!/usr/bin/env bash
set -euo pipefail

# Usage: AZURE_TARGET=user@host AZURE_KEY=~/Downloads/key.pem ./deploy.sh
AZURE_TARGET="${AZURE_TARGET:-${1:-}}"
AZURE_KEY="${AZURE_KEY:-${2:-$HOME/Downloads/bigwarn-vm_key.pem}}"

if [[ -z "$AZURE_TARGET" ]]; then
  echo "Usage: $0 <user@azure-ip> [path/to/key.pem]"
  exit 1
fi

BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"

rsync -avz --delete \
  --exclude='.DS_Store' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='data/logs/*' \
  --exclude='data/seen_urls.json' \
  --exclude='data/dynamic_locations_cache.json' \
  --exclude='lakehouse/storage/*' \
  -e "ssh -i $AZURE_KEY" \
  "$BACKEND_DIR" "${AZURE_TARGET}:~/real-time-alert/"

ssh -i "$AZURE_KEY" "$AZURE_TARGET" "sudo systemctl restart bigwarn-scraper bigwarn-api 2>/dev/null || true"
echo "Cleanly deployed backend/ (without .DS_Store or __pycache__)."
