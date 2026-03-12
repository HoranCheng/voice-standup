# 早会 Voice Standup

开车时用语音跟 AI 开早会，讨论完自动把指令发给团队。

## 架构

```text
[PWA] ←→ [Cloudflare Worker] ←→ [Claude API]
                   ↓
            [Discord Webhook]
```

## 当前地址

- GitHub: <https://github.com/HoranCheng/voice-standup>
- Live: <https://horancheng.github.io/voice-standup/>

## 快速开始

### 前端

```bash
npm install
npm run build
npm run deploy
```

### Worker

看 `DEPLOY.md`。

最短路径：

```bash
cd worker
npm install
cp .env.example .env.local
# 填好 .env.local
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

### App 配置

打开 PWA → 设置：

- Worker URL: `https://voice-standup.xxx.workers.dev`
- Auth Token: 部署时设置的 `AUTH_TOKEN`
- Products JSON: 产品列表

## 技术栈

- **前端**: React + Vite PWA
- **语音识别**: Web Speech API
- **语音合成**: SpeechSynthesis API
- **AI**: Claude API (Anthropic)
- **后端**: Cloudflare Worker + KV
- **通知**: Discord Webhook

## 成本说明

- 浏览器语音能力：免费
- GitHub Pages：免费
- Cloudflare Worker / KV：小规模可走免费层
- **Claude 对话部分需要单独的 Anthropic API key，会产生 API 费用**

所以它**不是**直接复用 Claude Max 订阅。