# Deploy Guide — Voice Standup

## Reality check

This project **does not** use Claude Max subscription directly.

- Browser STT/TTS: free
- GitHub Pages hosting: free
- Cloudflare Worker + KV: small/free-tier friendly
- **Claude API calls: billed separately via Anthropic API key**

So if you want the app to speak with Claude through the Worker, you need a real `CLAUDE_API_KEY`.

ChatGPT Plus / Pro also cannot be converted into an OpenAI API key.

---

## 1. Frontend already deployed

Current URL:

- <https://horancheng.github.io/voice-standup/>

If you update frontend code later:

```bash
cd voice-standup
npm install
npm run build
npx gh-pages -d dist
```

---

## 2. Create Cloudflare resources

Inside `voice-standup/worker`:

```bash
npm install
npx wrangler login
npx wrangler kv namespace create STANDUPS
```

Copy the returned namespace ID into:

- `worker/wrangler.toml`
- `worker/.env.local` as `KV_NAMESPACE_ID=...`

---

## 3. Prepare env

```bash
cd voice-standup/worker
cp .env.example .env.local
```

Fill these values:

- `AUTH_TOKEN`: random long token for browser → Worker auth
- `CLAUDE_API_KEY`: Anthropic API key
- `ALLOWED_ORIGIN`: usually `https://horancheng.github.io`
- `WEBHOOK_RECEIPT_RENAMER`: Discord webhook for team directives

---

## 4. One-command bootstrap

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

That script will:

1. validate env
2. upload Worker secrets
3. deploy the Worker

---

## 5. Configure the PWA

Open:

- <https://horancheng.github.io/voice-standup/>

Then Settings:

- Worker URL → your deployed Worker URL
- Auth Token → same `AUTH_TOKEN`
- Products JSON → for example:

```json
[
  {
    "id": "receipt-renamer",
    "name": "小票助手",
    "discordChannelId": "1481628187615035542"
  },
  {
    "id": "voice-standup",
    "name": "语音早会",
    "discordChannelId": "1481628187615035542"
  }
]
```

---

## 6. Suggested production hardening

Before regular use:

- set `ALLOW_CLIENT_SYSTEM=false`
- keep `ALLOWED_ORIGIN` strict
- rotate `AUTH_TOKEN` if shared accidentally
- keep each product on its own Discord webhook
- add Worker rate limiting if usage grows

---

## 7. Current state

Done:

- frontend built
- GitHub repo pushed
- GitHub Pages live
- Worker code written
- Worker tests passing

Still manual:

- Cloudflare login
- KV namespace creation
- secret upload
- final Worker deploy
