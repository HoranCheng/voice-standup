# Voice Standup TTS Review: Google Translate TTS via Worker Proxy

## Review 目标
**临时止血切换。** Edge TTS WebSocket 在 iOS Safari 不可用（无法伪造 Origin header），需要替代方案让 Henry 能用。

解决的问题：
- iOS Safari Edge WS 不可用 → 换成 Worker proxy
- 音量键不可控（SpeechSynthesis）→ `<audio>` 播放 mp3，走媒体音量通道

不解决的问题（V2）：
- 音质（Google Translate TTS 质量一般，但比浏览器 TTS 好）
- 长期稳定性（Google Translate TTS 是非官方接口）

## 关键文件
| 文件 | 状态 | 说明 |
|------|------|------|
| `src/tts.js` | 修改 | provider 从 edgeTTS 改为 speakServer（Worker proxy）|
| `src/api.js` | 修改 | 恢复 ttsAudio() 函数 |
| `worker/src/index.js` | 修改 | 重新加 /api/tts 端点 |
| `src/ttsSegments.js` | 修改 | maxChars 调到 180 |
| `src/edgeTTS.js` | 保留 | 不删，但不在主链路 |
| `src/config.js` | 未改 | ttsEngine 仍为 'edge'，但 tts.js 内部优先走 server |

## 架构链路
```
speak(text)
  → splitTextForTTS(text)           // maxChars=180
  → speakServer(segments)           // Worker proxy
    → ttsAudio(segment)             // POST /api/tts
    → Worker: Google Translate TTS  // translate.google.com/translate_tts
    → 返回 mp3 blob
    → playAudioBlob(blob)           // <audio> element
    → 180ms pause
  → [Server 失败] speakBrowser()   // fallback SpeechSynthesis
```

## Worker /api/tts 端点
- 接受 `{ text, lang }` POST body
- text 限制 `slice(0, 200)`（Google TTS 限制）
- 用 `User-Agent: Mozilla/5.0` header 调 Google Translate
- 返回 `audio/mpeg` response
- 不暴露任何凭证（Google Translate TTS 不需要 API key）

## Fallback 边界条件
- ttsAudio() 返回 null → speakServer 返回 false
- speakServer 返回 false → speak() 调 speakBrowser()
- speakBrowser 用同样的 segments 从头播
- _cancel 在任何阶段中断

## 分段与 200 字符限制
- splitTextForTTS maxChars=180（留 20 字符安全余量）
- 句号→逗号→硬切 3 层规则不变
- 前端按 180 字符保守分段，Worker 仍对文本做 200 字符兜底截断，以降低 Google Translate TTS 请求超限风险
- 不会丢内容：只是切更细

## 验证结果
- `curl -X POST .../api/tts -d '{"text":"你好世界","lang":"zh-CN"}'` → HTTP 200, 12KB
- `file output.mp3` → MPEG ADTS, layer III
- `npm run build` 通过
- Worker `npx wrangler deploy` 通过

## Review 重点（3 条）
1. Worker TTS proxy 是否安全（无凭证暴露，CORS 正确）
2. 前端 fallback 链路完整性（server 失败 → browser）
3. 分段 180 字符 + Google 200 字符限制 → 是否有边界丢内容

## Commit
`cf5144a`

## State Card
`STATE_voice-standup.md`
