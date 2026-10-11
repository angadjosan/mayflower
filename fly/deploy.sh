#!/usr/bin/env bash
# Create (once) and deploy the 30s ticker on Fly.io. Needs `fly auth login` first.
# Reads CRON_SECRET from .env.local; MAYFLOWER_URL defaults to production.
set -euo pipefail
cd "$(dirname "$0")"
APP=mayflower-ticker
URL="${MAYFLOWER_URL:-https://mayflower-lac.vercel.app}"
SECRET="$(grep '^CRON_SECRET=' ../.env.local | cut -d= -f2-)"
[ -n "$SECRET" ] || { echo "CRON_SECRET missing in .env.local"; exit 1; }

fly status -a "$APP" >/dev/null 2>&1 || fly apps create "$APP" --org personal
printf 'MAYFLOWER_URL=%s\nCRON_SECRET=%s\n' "$URL" "$SECRET" | fly secrets import -a "$APP" --stage
fly deploy -c fly.toml -a "$APP" --ha=false
fly scale count 1 -a "$APP" --yes
echo "Logs: fly logs -a $APP"
