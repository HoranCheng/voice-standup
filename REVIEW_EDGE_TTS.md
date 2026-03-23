# Edge TTS Review Package

## Review 目标
Edge TTS 实验性接入 + 文本分段 + provider fallback

## 关键文件列表
| 文件 | 状态 | 说明 |
|------|------|------|
| `src/edgeTTS.js` | 新增 | Edge TTS WebSocket 客户端 |
| `src/ttsSegments.js` | 新增 | 文本分段模块 |
| `src/tts.js` | 重写 | provider cascade 入口 |
| `src/config.js` | 修改 | ttsEngine 默认 free |
| `src/api.js` | 修改 | 超时 60s |
| `worker/src/index.js` | 修改 | 保留但不在主链路 |
| `src/stt.js` | 未改动 | — |
| `src/App.jsx` | 未改动 | — |

## 架构链路
```
speak(text)
  → splitTextForTTS(text)          // ttsSegments.js
  → speakEdge(segments, voice)     // edgeTTS.js via WebSocket
    → edgeTTS(segment)             // wss://speech.platform.bing.com
    → playAudioBlob(blob)          // <audio> element 播放 mp3
    → 180ms pause
    → 下一段...
  → [Edge 任一段失败]
    → speakBrowser(segments, lang) // 从头用 SpeechSynthesis 播
    → SpeechSynthesisUtterance per segment
    → 200ms pause
    → 下一段...
```

## ttsSegments.js 完整逻辑
- 先按 `。！？；：!?;:\n` 切句子
- 句子超 120 字 → 按 `，、,` 切从句
- 从句合并时不超 36 字软限制（commaSoftLimit）
- 合并后仍超 120 字 → 硬切 120 字
- 参数全部可配：`maxChars=120, commaSoftLimit=36, pauseMs=180`

## edgeTTS.js fallback 边界条件
- WS 连接失败 → onerror → reject → speakEdge catch → 返回 false
- WS 连上但 30s 没收到 turn.end → timeout reject → 返回 false
- WS 关闭但没收到 turn.end 且有 audio chunks → 仍 resolve（部分音频可用）
- WS 关闭且没有 audio chunks → reject

## speak() fallback 顺序
1. ttsEngine === 'free' → 先试 speakEdge
2. speakEdge 返回 false（任一段失败）→ 进 speakBrowser
3. speakBrowser 用同样的 segments 从头播
4. _cancel 在任何阶段都能中断，不会进 fallback

## 互斥 + 清理链路
- speak() 入口：如果 _speaking 为 true → 先调 stopSpeaking() 停掉上一轮
- stopSpeaking()：_cancel=true + speechSynthesis.cancel() + audio.pause() + 清空 src + 置空 _currentAudio + _speaking=false
- 每个 playAudioBlob 前检查 _cancel
- 每个 speakEdge/speakBrowser 循环内检查 _cancel

## Worker fallback 状态
Worker 的 /api/tts 端点仍存在于 worker/src/index.js，但当前没有任何前端代码调用它。不在主链路中。历史遗留，保留但不影响。

## Review 重点（4 条）
1. Provider 抽象 — speakEdge 和 speakBrowser 独立，不互相调用
2. Fallback 可靠性 — Edge 失败后浏览器 TTS 从头播完整文本
3. 断句可维护性 — ttsSegments.js 独立模块，参数可配
4. 重入防护 — _speaking 互斥 + _cancel flag + stopSpeaking() 清理
