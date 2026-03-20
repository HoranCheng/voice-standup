import React, { useState, useEffect, useRef, useCallback, Component } from 'react';
import { loadConfig, saveConfig } from './config';
import { isSTTSupported, createRecognizer } from './stt';
import { speak, stopSpeaking, unlockAudio } from './tts';
import { chat, getStandup, publishDirective, publishToCommand } from './api';

// ─── Error Boundary ──────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100dvh', background: '#0a0a0f', color: '#e4e4e7',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '40px 24px', gap: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>应用出错了</div>
          <div style={{ fontSize: 14, color: '#a1a1aa', maxWidth: 300, lineHeight: 1.6 }}>
            {this.state.error?.message || '发生了未知错误'}
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            style={{
              marginTop: 8, padding: '12px 32px', borderRadius: 12, border: 'none',
              background: '#6366f1', color: '#fff', fontSize: 15, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            重试
          </button>
          <button
            onClick={() => { window.location.reload(); }}
            style={{
              padding: '10px 24px', borderRadius: 10, border: '1px solid #3f3f46',
              background: 'transparent', color: '#71717a', fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Theme ───────────────────────────────────────────────────────────────────
const T = {
  bg: '#0a0a0f', card: '#18181b', sf: '#27272a', bdr: '#3f3f46',
  tx: '#e4e4e7', tx2: '#a1a1aa', tx3: '#71717a',
  acc: '#6366f1', accDim: 'rgba(99,102,241,0.15)',
  red: '#ef4444', green: '#22c55e', amber: '#f59e0b',
};
const F = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// ─── System prompt (server-side copy in Worker; client-side used for display) ─
const SYSTEM_PROMPT = `你是产品负责人的早会助手。

你的职责：
1. 如果有今日简报，第一轮回复时必须主动朗读简报要点（逐条念出关键信息，不要只说"有更新"）
2. 简洁地向负责人汇报早报要点
3. 回答他关于进展的问题
4. 当他给出指导意见时，确认并记录
5. 当他说"结束会议"时，整理出结构化的指导意见文稿

沟通风格：
- 简洁直接，不废话
- 用中文
- 像一个高效的技术总监在开站会
- 需要他做决定的地方主动提出来
- 朗读简报时按优先级排列，先说最重要的

当用户说"结束会议"或类似表达时，输出以下格式的整理稿：
"""
[产品名] — 指导意见
日期：YYYY-MM-DD

1. [第一条意见]
2. [第二条意见]
...
"""`;

// ─── Main App ────────────────────────────────────────────────────────────────
function AppInner() {
  // Detect Siri/autostart mode from URL param: ?autostart=1
  const autostartMode = new URLSearchParams(window.location.search).get('autostart') === '1';

  // Clear ?autostart=1 from URL to prevent re-trigger on refresh
  useEffect(() => {
    if (autostartMode) {
      const url = new URL(window.location);
      url.searchParams.delete('autostart');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [view, setView] = useState(autostartMode ? 'taptostart' : 'home');
  const [config, setConfig] = useState(loadConfig);
  const [products, setProducts] = useState(() => config.products || []);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [standup, setStandup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [listening, setListening] = useState(false);
  const [speaking_, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  // Refs for stable closure access
  const recRef = useRef(null);
  const timerRef = useRef(null);
  const messagesRef = useRef([]);
  const chatEndRef = useRef(null);
  const listeningRef = useRef(false);
  const wakeLockRef = useRef(null);
  const standupRef = useRef(null);

  // Driving mode: useState for re-render + ref for stable closure access
  const [drivingMode, setDrivingMode] = useState(false);
  const drivingModeRef = useRef(false);
  // Stable ref for handleUserMessage to avoid circular deps in startListening
  const handleUserMessageRef = useRef(null);
  // Retry backoff counter for driving mode error recovery
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 5;

  // Keep refs in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { standupRef.current = standup; }, [standup]);
  useEffect(() => { drivingModeRef.current = drivingMode; }, [drivingMode]);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Timer
  useEffect(() => {
    if (view === 'meeting') {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [view]);

  // Cleanup wake lock on unmount
  useEffect(() => {
    return () => {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, []);

  // ─── STT helpers (stable refs, no stale closures) ───────────────────────
  const startListening = useCallback(() => {
    if (recRef.current) recRef.current.abort();

    const rec = createRecognizer(config.lang, {
      onResult: ({ final: f, interim: i, isFinal }) => {
        setInterim(isFinal ? '' : i);

        // Driving mode: auto-send when speech finalises — no button needed
        if (isFinal && f.trim() && drivingModeRef.current) {
          listeningRef.current = false;
          setListening(false);
          setInterim('');
          handleUserMessageRef.current?.(f.trim());
        }
      },
      onEnd: () => {
        // Auto-restart loop for continuous listening (uses ref, never stale)
        if (listeningRef.current) {
          try { rec.start(); } catch {}
        }
      },
      onError: (err) => {
        setError(`语音识别错误: ${err}`);
      },
    });

    if (!rec) {
      setError('此浏览器不支持语音识别，请使用 Chrome 或 Safari');
      return;
    }

    recRef.current = rec;
    listeningRef.current = true;
    setListening(true);
    rec.start();
  }, [config.lang]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    const rec = recRef.current;
    if (!rec) return Promise.resolve('');
    return rec.stopAndWait(2000);
  }, []);

  // ─── Send user message → AI → TTS ──────────────────────────────────────
  const handleUserMessage = useCallback(async (text) => {
    if (!text) return;

    const userMsg = { role: 'user', content: text };
    const updated = [...messagesRef.current, userMsg];
    setMessages(updated);

    // Check for end-of-meeting trigger
    const endTriggers = ['结束会议', '结束', '就这样', '好了', '结束吧'];
    const isEnd = endTriggers.some(t => text.includes(t));

    setLoading(true);
    try {
      const chatMessages = updated
        .filter(m => !m.hidden)
        .map(m => ({ role: m.role, content: m.content }));

      if (isEnd) {
        chatMessages.push({
          role: 'user',
          content: '请根据我们的对话，整理出结构化的指导意见文稿。',
        });
      }

      // Standup injected via system prompt only (not duplicated in messages)
      const systemWithStandup = SYSTEM_PROMPT +
        (standupRef.current ? `\n\n[今日早报]\n${standupRef.current}` : '');

      const reply = await chat(chatMessages, systemWithStandup);
      const aiMsg = { role: 'assistant', content: reply };
      setMessages(prev => [...prev, aiMsg]);

      if (isEnd) {
        setSummary(reply);
        setView('summary');
        clearInterval(timerRef.current);
        wakeLockRef.current?.release();
        wakeLockRef.current = null;
        setDrivingMode(false);
      }

      // Speak response
      setSpeaking(true);
      await speak(reply, config.lang);
      setSpeaking(false);

      // Driving mode: auto-restart listening after AI finishes speaking
      if (drivingModeRef.current && !isEnd) {
        retryCountRef.current = 0; // reset on success
        startListening();
      }
    } catch (e) {
      setError(e.message);
      // Driving mode: retry with exponential backoff + max retries
      if (drivingModeRef.current) {
        retryCountRef.current++;
        if (retryCountRef.current <= MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 16000);
          // Speak error hint in driving mode
          if (retryCountRef.current === 1) {
            speak('网络异常，稍后重试', config.lang);
          }
          setTimeout(() => {
            if (drivingModeRef.current) startListening();
          }, delay);
        } else {
          // Give up after max retries
          speak('多次重试失败，请检查网络后手动重新开始', config.lang);
          setDrivingMode(false);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [config.lang, startListening]);

  // Keep handleUserMessageRef in sync (avoids stale closure in startListening)
  useEffect(() => {
    handleUserMessageRef.current = handleUserMessage;
  }, [handleUserMessage]);

  // ─── Start meeting ──────────────────────────────────────────────────────
  // driving: true → enables auto-listen/auto-send (Siri/hands-free mode)
  const startMeeting = useCallback(async (product, { driving = false } = {}) => {
    // Unlock iOS audio SYNCHRONOUSLY inside this gesture handler
    unlockAudio();

    setDrivingMode(driving);
    retryCountRef.current = 0;
    setSelectedProduct(product);
    setMessages([]);
    setElapsed(0);
    setError('');
    setSummary('');
    setPublished(false);
    setView('meeting');

    // Request wake lock (keep screen on while driving)
    try {
      wakeLockRef.current = await navigator.wakeLock?.request('screen');
    } catch { /* not supported, fail silently */ }

    // Fetch standup
    let standupText = null;
    if (config.workerUrl) {
      try {
        standupText = await getStandup(product.id);
      } catch (e) {
        console.warn('Failed to fetch standup:', e);
      }
    }
    setStandup(standupText);

    // AI greeting — if standup exists, use AI to read the briefing naturally
    if (standupText) {
      // Let AI generate a proper briefing readout via chat
      const systemWithStandup = SYSTEM_PROMPT + `\n\n[今日简报]\n${standupText}`;
      setMessages([{ role: 'assistant', content: '正在读取今日简报...' }]);

      try {
        setLoading(true);
        const briefingReadout = await chat(
          [{ role: 'user', content: `早上好，请给我读一下今天${product.name}的简报要点。` }],
          systemWithStandup
        );
        setMessages([
          { role: 'user', content: `开始${product.name}早会`, hidden: true },
          { role: 'assistant', content: briefingReadout },
        ]);
        setLoading(false);

        setSpeaking(true);
        await speak(briefingReadout, config.lang);
        setSpeaking(false);
      } catch (e) {
        // Fallback to static greeting if AI fails
        const fallback = `早上好。今天${product.name}有简报，但读取失败了。有什么想讨论的？`;
        setMessages([{ role: 'assistant', content: fallback }]);
        setLoading(false);
        setSpeaking(true);
        await speak(fallback, config.lang);
        setSpeaking(false);
      }
    } else {
      const greeting = `早上好。今天${product.name}暂时没有新的早报，有什么想讨论的？`;
      setMessages([{ role: 'assistant', content: greeting }]);

      setSpeaking(true);
      await speak(greeting, config.lang);
      setSpeaking(false);
    }

    if (driving) {
      startListening();
    }
  }, [config, startListening]);

  // ─── Push-to-talk handlers (manual mode only) ───────────────────────────
  const handlePushStart = useCallback(() => {
    stopSpeaking(); // Interrupt AI if it's talking
    startListening();
  }, [startListening]);

  const handlePushEnd = useCallback(async () => {
    const transcript = await stopListening();
    if (transcript) {
      handleUserMessage(transcript);
    }
  }, [stopListening, handleUserMessage]);

  // ─── End meeting manually ───────────────────────────────────────────────
  const endMeeting = useCallback(async () => {
    setDrivingMode(false);
    const transcript = await stopListening();
    stopSpeaking();
    handleUserMessage(transcript ? transcript + ' 结束会议' : '结束会议，请整理指导意见。');
  }, [stopListening, handleUserMessage]);

  // ─── Publish to Discord ─────────────────────────────────────────────────
  const handlePublish = useCallback(async () => {
    if (!selectedProduct || !summary) return;
    setPublishing(true);
    try {
      // Dual publish: product channel + command channel
      await publishDirective(selectedProduct.id, summary);
      // Command channel publish (best-effort, don't block on failure)
      publishToCommand(selectedProduct.id, summary);
      setPublished(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  }, [selectedProduct, summary]);

  // ─── Save settings ─────────────────────────────────────────────────────
  const handleSaveConfig = useCallback((newCfg) => {
    setConfig(newCfg);
    setProducts(newCfg.products || []);
    saveConfig(newCfg);
    setView('home');
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────
  const formatTime = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  return (
    <div style={{
      minHeight: '100dvh', background: T.bg, color: T.tx, fontFamily: F,
      padding: 'env(safe-area-inset-top) 16px env(safe-area-inset-bottom)',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* ─── Tap-to-Start (Siri / ?autostart=1 entry point) ─── */}
      {view === 'taptostart' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 24 }}>
          {!isSTTSupported() ? (
            <div style={{
              padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.15)',
              color: T.red, fontSize: 13, maxWidth: 300, textAlign: 'center',
            }}>
              ⚠️ 此浏览器不支持语音识别，请使用 Safari
            </div>
          ) : products.length === 0 ? (
            <>
              <div style={{ fontSize: 48 }}>⚙️</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>还没有配置产品</div>
              <button onClick={() => setView('settings')} style={btnStyle(T.acc)}>去设置</button>
            </>
          ) : products.length === 1 ? (
            // Single product — one big tap area, start immediately
            <div
              onClick={() => startMeeting(products[0], { driving: true })}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
                padding: '60px 40px', borderRadius: 32,
                border: `2px solid ${T.acc}`, background: T.accDim,
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 72 }}>🎙</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>点击开始</div>
              <div style={{ fontSize: 15, color: T.tx2 }}>{products[0].name}</div>
              <div style={{ fontSize: 12, color: T.tx3, marginTop: 4 }}>之后全程免手触 · 驾车模式</div>
            </div>
          ) : (
            // Multiple products — pick one
            <>
              <div style={{ fontSize: 48 }}>🎙</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>选择产品开始站会</div>
              <div style={{ fontSize: 12, color: T.tx3 }}>驾车模式 · 全程免手触</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
                {products.map(p => (
                  <button
                    key={p.id}
                    onClick={() => startMeeting(p, { driving: true })}
                    style={{
                      padding: '20px', borderRadius: 16, border: `1px solid ${T.bdr}`,
                      background: T.card, color: T.tx, fontSize: 18, fontWeight: 700,
                      cursor: 'pointer', fontFamily: F, textAlign: 'center',
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Home ─── */}
      {view === 'home' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 24, padding: '40px 0' }}>
          <div style={{ fontSize: 48 }}>☀️</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>早会</div>
          <div style={{ fontSize: 14, color: T.tx3 }}>选择产品开始今天的早会</div>

          {!isSTTSupported() && (
            <div style={{
              padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.15)',
              color: T.red, fontSize: 13, maxWidth: 300, textAlign: 'center',
            }}>
              ⚠️ 此浏览器不支持语音识别，请使用 Chrome 或 Safari
            </div>
          )}

          {products.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 13, color: T.tx3, marginBottom: 16 }}>还没有配置产品，先去设置</div>
              <button onClick={() => setView('settings')} style={btnStyle(T.acc)}>⚙️ 设置</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
              {products.map(p => (
                <button key={p.id} onClick={() => startMeeting(p)} style={{
                  padding: '16px 20px', borderRadius: 16, border: `1px solid ${T.bdr}`,
                  background: T.card, color: T.tx, fontSize: 16, fontWeight: 700,
                  cursor: 'pointer', fontFamily: F, textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <span style={{ fontSize: 24 }}>🎙</span>
                  <div>
                    <div>{p.name}</div>
                    <div style={{ fontSize: 11, color: T.tx3, fontWeight: 400 }}>{p.id}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <button onClick={() => setView('settings')} style={{
            marginTop: 20, padding: '10px 20px', borderRadius: 10, border: `1px solid ${T.bdr}`,
            background: 'transparent', color: T.tx3, fontSize: 13, cursor: 'pointer', fontFamily: F,
          }}>⚙️ 设置</button>
        </div>
      )}

      {/* ─── Meeting ─── */}
      {view === 'meeting' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 0', borderBottom: `1px solid ${T.bdr}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.red, animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>早会进行中</span>
              {drivingMode && (
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 6,
                  background: 'rgba(245,158,11,0.2)', color: T.amber,
                }}>🚗 驾车</span>
              )}
            </div>
            <span style={{ fontSize: 13, color: T.tx3, fontFamily: 'monospace' }}>{formatTime(elapsed)}</span>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
            {messages.filter(m => !m.hidden).map((m, i) => (
              <div key={i} style={{
                marginBottom: 12, padding: '10px 14px', borderRadius: 14,
                background: m.role === 'user' ? T.accDim : T.card,
                maxWidth: '85%', marginLeft: m.role === 'user' ? 'auto' : 0,
                marginRight: m.role === 'assistant' ? 'auto' : 0,
              }}>
                <div style={{ fontSize: 10, color: T.tx3, marginBottom: 4 }}>
                  {m.role === 'user' ? '你' : 'AI 助手'}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.content}</div>
              </div>
            ))}
            {interim && (
              <div style={{
                marginBottom: 12, padding: '10px 14px', borderRadius: 14,
                background: T.accDim, maxWidth: '85%', marginLeft: 'auto', opacity: 0.6,
              }}>
                <div style={{ fontSize: 14, lineHeight: 1.6 }}>{interim}…</div>
              </div>
            )}
            {loading && (
              <div style={{ padding: '10px 14px', color: T.tx3, fontSize: 13 }}>
                AI 思考中…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Controls */}
          <div style={{
            display: 'flex', gap: 12, padding: '16px 0',
            borderTop: `1px solid ${T.bdr}`, justifyContent: 'center', alignItems: 'center',
          }}>
            {drivingMode ? (
              // ── Driving mode: status indicator + end button only ──
              <>
                <div style={{
                  flex: 1, padding: '20px 16px', borderRadius: 20,
                  background: T.card, border: `1px solid ${T.bdr}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                }}>
                  <div style={{ fontSize: 28 }}>
                    {speaking_ ? '🔊' : listening ? '🔴' : loading ? '⏳' : '⏸'}
                  </div>
                  <div style={{ fontSize: 12, color: T.tx3 }}>
                    {speaking_ ? 'AI 说话中' : listening ? '正在聆听...' : loading ? '处理中' : '等待中'}
                  </div>
                </div>
                <button onClick={endMeeting} style={{
                  padding: '0 24px', height: 64, borderRadius: 20,
                  border: `1px solid ${T.bdr}`, background: T.card,
                  color: T.tx, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: F,
                }}>
                  ⏹ 结束
                </button>
              </>
            ) : (
              // ── Manual mode: push-to-talk ──
              <>
                <button
                  onPointerDown={handlePushStart}
                  onPointerUp={handlePushEnd}
                  onPointerCancel={handlePushEnd}
                  disabled={loading}
                  style={{
                    width: 96, height: 96, borderRadius: '50%', border: 'none',
                    background: listening ? T.red : T.acc,
                    color: '#fff', fontSize: 32, cursor: loading ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s, transform 0.1s',
                    transform: listening ? 'scale(1.1)' : 'scale(1)',
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                  }}
                >
                  {listening ? '🔴' : '🎙'}
                </button>
                <button onClick={endMeeting} style={{
                  padding: '0 24px', height: 56, borderRadius: 28,
                  border: `1px solid ${T.bdr}`, background: T.card,
                  color: T.tx, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: F,
                }}>
                  ⏹ 结束
                </button>
              </>
            )}
          </div>

          {!drivingMode && (
            <div style={{ textAlign: 'center', paddingBottom: 8, fontSize: 11, color: T.tx3 }}>
              {listening ? '正在听…松手发送' : loading ? 'AI 思考中' : '按住说话'}
            </div>
          )}
        </div>
      )}

      {/* ─── Summary ─── */}
      {view === 'summary' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 0' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>会议已结束</div>
            <div style={{ fontSize: 13, color: T.tx3 }}>时长 {formatTime(elapsed)}</div>
          </div>

          <div style={{
            flex: 1, background: T.card, borderRadius: 16, padding: 16,
            fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowY: 'auto',
            border: `1px solid ${T.bdr}`,
          }}>
            {summary}
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button onClick={() => setView('home')} style={{
              flex: 1, padding: '14px 0', borderRadius: 12, border: `1px solid ${T.bdr}`,
              background: 'transparent', color: T.tx2, fontSize: 14, cursor: 'pointer', fontFamily: F,
            }}>返回首页</button>
            <button
              onClick={handlePublish}
              disabled={publishing || published}
              style={{
                flex: 2, padding: '14px 0', borderRadius: 12, border: 'none',
                background: published ? T.green : T.acc,
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: publishing ? 'wait' : 'pointer', fontFamily: F,
              }}
            >
              {published ? '✅ 已发送' : publishing ? '发送中…' : '📤 发送给团队'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Settings ─── */}
      {view === 'settings' && <Settings config={config} onSave={handleSaveConfig} onBack={() => setView('home')} />}

      {/* Error toast */}
      {error && (
        <div onClick={() => setError('')} style={{
          position: 'fixed', bottom: 100, left: 16, right: 16,
          padding: '12px 16px', borderRadius: 12,
          background: 'rgba(239,68,68,0.9)', color: '#fff',
          fontSize: 13, cursor: 'pointer', zIndex: 100,
        }}>
          ⚠️ {error}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────
function btnStyle(bg) {
  return {
    padding: '12px 24px', borderRadius: 12, border: 'none',
    background: bg, color: '#fff', fontSize: 14, fontWeight: 700,
    cursor: 'pointer', fontFamily: F,
  };
}

// ─── Settings Panel ──────────────────────────────────────────────────────────
function Settings({ config, onSave, onBack }) {
  const [workerUrl, setWorkerUrl] = useState(config.workerUrl);
  const [authToken, setAuthToken] = useState(config.authToken);
  const [productsJson, setProductsJson] = useState(JSON.stringify(config.products || [], null, 2));

  const save = () => {
    let products = [];
    try { products = JSON.parse(productsJson); } catch {}
    onSave({ ...config, workerUrl, authToken, products });
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    border: `1px solid ${T.bdr}`, background: T.sf, color: T.tx,
    fontSize: 14, fontFamily: F, outline: 'none',
  };

  return (
    <div style={{ flex: 1, padding: '20px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <button onClick={onBack} style={{
          padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.bdr}`,
          background: 'transparent', color: T.tx2, fontSize: 13, cursor: 'pointer', fontFamily: F,
        }}>← 返回</button>
        <span style={{ fontSize: 16, fontWeight: 800 }}>设置</span>
        <button onClick={save} style={{
          padding: '8px 16px', borderRadius: 8, border: 'none',
          background: T.acc, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: F,
        }}>保存</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, color: T.tx3, display: 'block', marginBottom: 6 }}>Worker URL</label>
          <input value={workerUrl} onChange={e => setWorkerUrl(e.target.value)} placeholder="https://voice-standup.xxx.workers.dev" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: T.tx3, display: 'block', marginBottom: 6 }}>认证 Token</label>
          <input value={authToken} onChange={e => setAuthToken(e.target.value)} type="password" placeholder="Bearer token" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: T.tx3, display: 'block', marginBottom: 6 }}>产品列表 (JSON)</label>
          <textarea
            value={productsJson}
            onChange={e => setProductsJson(e.target.value)}
            rows={8}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
            placeholder={`[\n  {\n    "id": "receipt-renamer",\n    "name": "小票助手",\n    "discordChannelId": "123"\n  }\n]`}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Export with Error Boundary ──────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
