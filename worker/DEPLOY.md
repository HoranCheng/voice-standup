# Worker Deployment Guide

⚠️ **All commands must run on the OpenClaw host machine** (where `~/.openclaw/workspace-alpha/` exists).

## Prerequisites

- Node.js 18+
- Cloudflare account

## Steps

### 1. Login to Cloudflare

```bash
cd ~/.openclaw/workspace-alpha/voice-standup/worker
npx wrangler login
```

Browser will open for OAuth authorization.

### 2. Create KV Namespace

```bash
npx wrangler kv namespace create STANDUPS
```

**Copy the `id` value from the output** — you'll need it in step 3.

Output looks like:
```
{ binding = "STANDUPS", id = "abc123..." }
```

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and replace **all placeholder values** with real ones:

| Variable | What to fill | Example |
|---|---|---|
| `AUTH_TOKEN` | A random long string (generate with `openssl rand -hex 32`) | `a1b2c3d4e5...` |
| `CLAUDE_API_KEY` | Your Anthropic API key | `sk-ant-api03-...` |
| `ALLOWED_ORIGIN` | Your GitHub Pages URL | `https://horancheng.github.io` |
| `KV_NAMESPACE_ID` | The `id` from step 2 | `abc123...` |
| `WEBHOOK_*` | Discord webhook URLs per product | `https://discord.com/api/webhooks/...` |

**Important:** `KV_NAMESPACE_ID` only needs to be set in `.env.local`. The bootstrap script automatically syncs it to `wrangler.toml`.

### 4. Deploy

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

The script will:
1. Validate all required values (and reject placeholders)
2. Patch `wrangler.toml` with your KV ID and origin
3. Upload secrets to Cloudflare
4. Deploy the Worker

### 5. Configure PWA

In the Voice Standup PWA settings:
1. Set **Worker URL** to the deployed Worker URL (shown after deploy)
2. Set **Auth Token** to the same `AUTH_TOKEN` from `.env.local`
3. Configure **Products JSON** with your product definitions

## Troubleshooting

- **`ERROR: X still contains placeholder value`** — You haven't edited `.env.local`. Replace all placeholder values.
- **`Missing .env.local`** — Run `cp .env.example .env.local` first.
- **`wrangler not found`** — Run `npm install` in the worker directory.
