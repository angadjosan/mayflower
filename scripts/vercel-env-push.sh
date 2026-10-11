#!/usr/bin/env bash
# Push every non-empty KEY=VALUE from .env.local to the linked Vercel project.
# Usage: scripts/vercel-env-push.sh [env-file] [targets...]   (default: .env.local production preview)
# Run `vercel link` first. Values are piped on stdin, never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-.env.local}"; shift || true
TARGETS=("$@"); [ ${#TARGETS[@]} -eq 0 ] && TARGETS=(production preview)

[ -f "$FILE" ] || { echo "No $FILE"; exit 1; }
[ -d .vercel ] || { echo "Not linked — run: vercel link"; exit 1; }

# Local-only settings that must not reach Vercel (APP_URL is set to the deployment URL separately).
SKIP_RE='^(APP_URL|ALLOW_DEMO_USER|NODE_ENV|VERCEL_.*)$'

count=0
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
  # strip matching surrounding quotes
  if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
  [ -z "$val" ] && continue
  [[ "$key" =~ $SKIP_RE ]] && continue
  for t in "${TARGETS[@]}"; do
    vercel env rm "$key" "$t" --yes >/dev/null 2>&1 || true
    printf '%s' "$val" | vercel env add "$key" "$t" >/dev/null 2>&1 \
      && echo "✓ $key → $t" || echo "✗ $key → $t (failed)"
  done
  count=$((count + 1))
done < "$FILE"
echo "Pushed $count variables to: ${TARGETS[*]}"
