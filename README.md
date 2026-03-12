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

## 使用方式

### 🚗 驾车模式（推荐 — 免手触）

通过 Siri 快捷指令启动，全程语音控制：

1. iPhone → **快捷指令 App** → 新建快捷指令
2. 添加操作：**「Safari 中打开 URL」**
3. URL 填：`https://horancheng.github.io/voice-standup/?autostart=1`
4. 快捷指令命名：`开始站会`
5. 「添加到 Siri」→ 录制「开始站会」

之后说 **「嘿 Siri，开始站会」** 即可。

**流程：**
```
嘿 Siri，开始站会
  → 打开 PWA（全屏点击界面）
  → 单次点击（停车时）
  → 自动聆听 → AI 回复 → 自动再聆听
  → 全程免手触 ✅
```

> **为什么需要 1 次点击？**
> iOS Safari 安全策略要求首次启动录音必须在用户触摸事件内。
> 但此后所有重启都是自动的，无需再次触碰。

### 📱 手动模式

打开 PWA 首页 → 选产品 → 按住说话，松手发送。

## 快速开始（开发/部署）

### 前端

```bash
npm install
npm run build
npm run deploy   # 发布到 GitHub Pages
```

### Worker

详见 `DEPLOY.md`。最短路径：

```bash
cd worker
npm install
cp .env.example .env.local
# 填好 .env.local（AUTH_TOKEN, CLAUDE_API_KEY, WEBHOOK_xxx）
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

### 测试

```bash
cd worker
npm test   # 12 项 unit tests
```

### App 配置

打开 PWA → ⚙️ 设置：

- **Worker URL**: `https://voice-standup.xxx.workers.dev`
- **Auth Token**: 部署时设置的 `AUTH_TOKEN`
- **Products JSON**: 产品列表，例如：

```json
[
  {
    "id": "receipt-renamer",
    "name": "小票助手"
  }
]
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + Vite PWA |
| 语音识别 | Web Speech API (webkitSpeechRecognition) |
| 语音合成 | SpeechSynthesis API |
| AI | Claude API (Anthropic) |
| 后端 | Cloudflare Worker + KV |
| 通知 | Discord Webhook |
| 部署 | GitHub Pages (前端) + Cloudflare (Worker) |

## 成本说明

- 浏览器语音能力：**免费**
- GitHub Pages：**免费**
- Cloudflare Worker / KV：小规模走**免费层**
- **Claude 对话：需要独立的 Anthropic API key，按量计费**

> 注意：这不是直接复用 Claude Max 订阅，需要 API key。
