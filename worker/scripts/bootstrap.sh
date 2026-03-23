#!/usr/bin/env bash
set -euo pipefail

# Voice Standup Worker bootstrap
# Usage:
#   cp .env.example .env.local
#   edit .env.local
#   ./scripts/bootstrap.sh

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local"
  echo "Copy .env.example → .env.local and fill it first."
  exit 1
fi

source .env.local

required=(AUTH_TOKEN CLAUDE_API_KEY ALLOWED_ORIGIN)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env: $key"
    exit 1
  fi
done

# Detect placeholder values that haven't been replaced
placeholders=("replace-with-" "your-" "sk-ant-...")
for key in AUTH_TOKEN CLAUDE_API_KEY KV_NAMESPACE_ID; do
  val="${!key:-}"
  for ph in "${placeholders[@]}"; do
    if [[ "$val" == *"$ph"* ]]; then
      echo "ERROR: $key still contains placeholder value."
      echo "  Current: $val"
      echo "  Edit .env.local and replace with the real value."
      exit 1
    fi
  done
done

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler not found. Run: npm install"
  exit 1
fi

echo "==> Ensuring KV namespace exists"
if [[ -z "${KV_NAMESPACE_ID:-}" ]]; then
  echo "Create KV namespace manually first:"
  echo "  npx wrangler kv namespace create STANDUPS"
  echo "Then set KV_NAMESPACE_ID in .env.local"
  exit 1
fi

echo "==> Patching wrangler.toml"
python3 - <<PY
from pathlib import Path
p = Path('wrangler.toml')
text = p.read_text()
text = text.replace('REPLACE_WITH_KV_ID', '''${KV_NAMESPACE_ID}''')
import re
text = re.sub(r'ALLOWED_ORIGIN\s*=\s*"[^"]*"', 'ALLOWED_ORIGIN = "'''+'''${ALLOWED_ORIGIN}'''+ '"', text)
p.write_text(text)
PY

echo "==> Writing secrets"
printf '%s' "$AUTH_TOKEN" | npx wrangler secret put AUTH_TOKEN
printf '%s' "$CLAUDE_API_KEY" | npx wrangler secret put CLAUDE_API_KEY

if [[ -n "${CLAUDE_MODEL:-}" ]]; then
  printf '%s' "$CLAUDE_MODEL" | npx wrangler secret put CLAUDE_MODEL
fi

if [[ -n "${SYSTEM_PROMPT:-}" ]]; then
  printf '%s' "$SYSTEM_PROMPT" | npx wrangler secret put SYSTEM_PROMPT
fi

# Any WEBHOOK_* variables in .env.local get uploaded as secrets
while IFS='=' read -r key value; do
  [[ -z "$key" ]] && continue
  [[ "$key" =~ ^# ]] && continue
  if [[ "$key" =~ ^WEBHOOK_ ]]; then
    value="${value%\r}"
    printf '%s' "$value" | npx wrangler secret put "$key"
  fi
done < .env.local

echo "==> Deploying worker"
ALLOWED_ORIGIN="$ALLOWED_ORIGIN" npx wrangler deploy

echo
 echo "Done. Next:"
 echo "1. Copy Worker URL into PWA settings"
 echo "2. Copy AUTH_TOKEN into PWA settings"
 echo "3. Configure products JSON in the app"
