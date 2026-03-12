# 早会 Voice Standup

开车时用语音跟 AI 开早会，讨论完自动把指令发给团队。

## 架构

```
[PWA] ←→ [Cloudflare Worker] ←→ [Claude API]
                   ↓
            [Discord Webhook]
```

## 快速开始

### 1. 部署 Worker

```bash
cd worker
npm install

# 设置环境变量（Cloudflare Dashboard 或 wrangler secret）
wrangler secret put AUTH_TOKEN        # 随机生成一个
wrangler secret put CLAUDE_API_KEY    # 你的 Claude API key
wrangler secret put CLAUDE_MODEL      # 可选，默认 claude-sonnet-4-20250514
wrangler secret put WEBHOOK_RECEIPT_RENAMER  # Discord webhook URL

# 创建 KV namespace
wrangler kv:namespace create STANDUPS
# 把返回的 ID 填入 wrangler.toml

wrangler deploy
```

### 2. 部署前端

```bash
npm install
npm run build
npm run deploy  # 部署到 GitHub Pages
```

### 3. 配置

打开 PWA → 设置 →
- Worker URL: `https://voice-standup.xxx.workers.dev`
- Auth Token: 上面设置的 AUTH_TOKEN
- 产品列表: JSON 格式

## 技术栈

- **前端**: React + Vite PWA
- **语音识别**: Web Speech API (浏览器原生)
- **语音合成**: SpeechSynthesis API (浏览器原生)
- **AI**: Claude API (Anthropic)
- **后端**: Cloudflare Worker + KV
- **通知**: Discord Webhook

## 成本

全走 Claude Max 订阅 + 免费浏览器 API = $0 额外费用
