import React, { useState, useEffect, useRef, useCallback } from 'react';
import { loadConfig, saveConfig } from './config';
import { isSTTSupported, createRecognizer } from './stt';
import { speak, stopSpeaking, isSpeaking } from './tts';
import { chat, getStandup, publishDirective } from './api';

// ─── Theme ───────────────────────────────────────────────────────────────────
const T = {
  bg: '#0a0a0f', card: '#18181b', sf: '#27272a', bdr: '#3f3f46',
  tx: '#e4e4e7', tx2: '#a1a1aa', tx3: '#71717a',
  acc: '#6366f1', accDim: 'rgba(99,102,241,0.15)',
  red: '#ef4444', green: '#22c55e', amber: '#f59e0b',
};
const F = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// ─── System prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `你是产品负责人的早会助手。你已经有今天的产品早报作为上下文。

你的职责：
1. 简洁地向负责人汇报早报要点
2. 回答他关于进展的问题
3. 当他给出指导意见时，确认并记录
4. 当他说"结束会议"时，整理出结构化的指导意见文稿

沟通风格：
- 简洁直接，不废话
- 用中文
- 像一个高效的技术总监在开站会
- 需要他做决定的地方主动提出来

当用户说"结束会议"或类似表达时，输出以下格式的整理稿：
"""
[产品名] — 指导意见
日期：YYYY-MM-DD

1. [第一条意见]
2. [第二条意见]
...
"""`;

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('home'); // home | meeting | summary | settings
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

  const recRef = useRef(null);
  const timerRef = useRef(null);
  const messagesRef = useRef([]);
  const chatEndRef = useRef(null);

  // Keep ref in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Timer
  useEffect(() => {
    if (view === 'meeting') {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [view]);

  // ─── Start meeting ──────────────────────────────────────────────────────
  const startMeeting = useCallback(async (product) => {
    setSelectedProduct(product);
    setMessages([]);
    setElapsed(0);
    setError('');
    setSummary('');
    setPublished(false);
    setView('meeting');

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

    // AI greeting
    const greeting = standupText
      ? `早上好。今天${product.name}有更新，我来给你简单说一下要点。`
      : `早上好。今天${product.name}暂时没有新的早报，有什么想讨论的？`;

    const contextMsg = standupText
      ? `[今日早报]\n${standupText}\n\n请简要总结给产品负责人听。`
      : '目前没有今日早报。等用户提问。';

    setMessages([
      { role: 'user', content: contextMsg, hidden: true },
      { role: 'assistant', content: greeting },
    ]);

    // Speak greeting
    setSpeaking(true);
    await speak(greeting, config.lang);
    setSpeaking(false);

    // Start listening
    startListening();
  }, [config]);

  // ─── STT ────────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (recRef.current) recRef.current.abort();
    const rec = createRecognizer(config.lang, {
      onResult: ({ final: f, interim: i, isFinal }) => {
        setInterim(isFinal ? '' : i);
        if (isFinal && f.trim()) {
          handleUserMessage(f.trim());
          rec.resetTranscript();
        }
      },
      onEnd: () => {
        // Auto-restart unless we stopped it
        if (listening) {
          try { rec.start(); } catch {}
        }
      },
      onError: (err) => {
        if (err !== 'aborted') setError(`语音识别错误: ${err}`);
      },
    });
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [config.lang, listening]);

  const stopListening = useCallback(() => {
    setListening(false);
    recRef.current?.stop();
  }, []);

  // ─── Handle user message → AI → TTS ────────────────────────────────────
  const handleUserMessage = useCallback(async (text) => {
    // Pause listening while AI responds
    recRef.current?.stop();
    setListening(false);

    const userMsg = { role: 'user', content: text };
    const updated = [...messagesRef.current, userMsg];
    setMessages(updated);

    // Check for end-of-meeting trigger
    const endTriggers = ['结束会议', '结束', '就这样', '好了', '结束吧'];
    const isEnd = endTriggers.some(t => text.includes(t));

    setLoading(true);
    try {
      const chatMessages = updated
        .filter(m => !m.hidden || m.role === 'user')
        .map(m => ({ role: m.role, content: m.content }));

      if (isEnd) {
        chatMessages.push({
          role: 'user',
          content: '请根据我们的对话，整理出结构化的指导意见文稿。',
        });
      }

      const reply = await chat(chatMessages, SYSTEM_PROMPT + (standup ? `\n\n[早报内容]\n${standup}` : ''));
      const aiMsg = { role: 'assistant', content: reply };
      setMessages(prev => [...prev, aiMsg]);

      if (isEnd) {
        setSummary(reply);
        setView('summary');
        clearInterval(timerRef.current);
      }

      // Speak response
      setSpeaking(true);
      await speak(reply, config.lang);
      setSpeaking(false);

      // Resume listening if still in meeting
      if (!isEnd) startListening();
    } catch (e) {
      setError(e.message);
      startListening();
    } finally {
      setLoading(false);
    }
  }, [standup, config.lang, startListening]);

  // ─── End meeting manually ───────────────────────────────────────────────
  const endMeeting = useCallback(() => {
    stopListening();
    stopSpeaking();
    handleUserMessage('结束会议，请整理指导意见。');
  }, [stopListening, handleUserMessage]);

  // ─── Publish to Discord ─────────────────────────────────────────────────
  const handlePublish = useCallback(async () => {
    if (!selectedProduct || !summary) return;
    setPublishing(true);
    try {
      await publishDirective(selectedProduct.id, summary);
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
      minHeight: '100vh', background: T.bg, color: T.tx, fontFamily: F,
      padding: 'env(safe-area-inset-top) 16px env(safe-area-inset-bottom)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ─── Home ─── */}
      {view === 'home' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 24, padding: '40px 0' }}>
          <div style={{ fontSize: 48 }}>☀️</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>早会</div>
          <div style={{ fontSize: 14, color: T.tx3 }}>选择产品开始今天的早会</div>

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
            borderTop: `1px solid ${T.bdr}`, justifyContent: 'center',
          }}>
            <button onClick={() => listening ? stopListening() : startListening()} style={{
              width: 64, height: 64, borderRadius: '50%', border: 'none',
              background: listening ? T.red : T.sf,
              color: '#fff', fontSize: 24, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {listening ? '🎙' : '🔇'}
            </button>
            <button onClick={endMeeting} style={{
              padding: '0 24px', height: 64, borderRadius: 32,
              border: `1px solid ${T.bdr}`, background: T.card,
              color: T.tx, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: F,
            }}>
              ⏹ 结束会议
            </button>
          </div>
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
