// ─── Text-to-Speech (Provider Abstraction) ───────────────────────────────────
//
// Providers:  server (Worker proxy → Google TTS) → browser (SpeechSynthesis)
// Segments:   Long text split into natural segments, played sequentially
// Driving:    Mutual exclusion — no overlapping audio, interruptible
// Audio path: <audio> element → media volume channel (phone volume keys work)

import { ttsAudio } from './api';
import { loadConfig } from './config';
import { splitTextForTTS } from './ttsSegments';

// ─── Playback state (singleton) ──────────────────────────────────────────────
let _speaking = false;
let _cancel = false;
let _currentAudio = null;

export function isTTSSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function stopSpeaking() {
  _cancel = true;
  window.speechSynthesis?.cancel();
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio.src = '';
    _currentAudio = null;
  }
  _speaking = false;
}

export function isSpeaking() { return _speaking; }

/**
 * Unlock iOS audio context — call synchronously inside a user gesture handler.
 */
export function unlockAudio() {
  if (isTTSSupported()) {
    const utt = new SpeechSynthesisUtterance('');
    utt.volume = 0;
    window.speechSynthesis.speak(utt);
  }
  // Also unlock <audio> playback context
  try {
    const a = new Audio();
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    a.volume = 0;
    a.play().catch(() => {});
  } catch {}
}

// ─── Audio segment player ────────────────────────────────────────────────────

function playAudioBlob(blob) {
  if (_cancel) return Promise.resolve(false);
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  _currentAudio = audio;

  return new Promise((resolve) => {
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      _currentAudio = null;
      resolve(true);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      _currentAudio = null;
      resolve(false);
    };
    audio.play().catch(() => {
      URL.revokeObjectURL(audioUrl);
      _currentAudio = null;
      resolve(false);
    });
  });
}

// ─── Provider: Server TTS (Worker proxy → Google Translate TTS) ──────────────

async function speakServer(segments, lang) {
  const PAUSE_MS = 250;
  for (let i = 0; i < segments.length; i++) {
    if (_cancel) return true;
    try {
      const blob = await ttsAudio(segments[i], { provider: 'free', lang });
      if (!blob || _cancel) return !_cancel;
      const ok = await playAudioBlob(blob);
      if (!ok && !_cancel) return false;
      if (i < segments.length - 1 && !_cancel) {
        await new Promise(r => setTimeout(r, PAUSE_MS));
      }
    } catch (e) {
      console.warn('Server TTS segment failed:', e);
      return false;
    }
  }
  return true;
}

// ─── Provider: Browser SpeechSynthesis (fallback) ────────────────────────────

function waitForVoices() {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) { resolve(voices); return; }
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    }, 2000);
  });
}

async function speakBrowser(segments, lang) {
  if (!isTTSSupported()) return false;

  const voices = await waitForVoices();
  const zhVoice = voices.find(v => v.lang.startsWith('zh')) ||
                  voices.find(v => v.lang.startsWith('cmn'));

  const isIOS = /iPhone|iPad/.test(navigator.userAgent);
  let keepAlive;
  if (isIOS) {
    keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
  }

  const PAUSE_MS = 200;

  return new Promise((resolve) => {
    let i = 0;
    function next() {
      if (_cancel || i >= segments.length) {
        clearInterval(keepAlive);
        resolve(!_cancel);
        return;
      }
      const utt = new SpeechSynthesisUtterance(segments[i]);
      utt.lang = lang;
      utt.rate = 1.1;
      utt.pitch = 1.0;
      if (zhVoice) utt.voice = zhVoice;

      utt.onend = () => { i++; setTimeout(next, PAUSE_MS); };
      utt.onerror = () => { i++; setTimeout(next, PAUSE_MS); };
      window.speechSynthesis.speak(utt);
    }
    next();
  });
}

// ─── Main speak() — provider cascade with fallback ───────────────────────────

export async function speak(text, lang = 'zh-CN') {
  if (!text) return;

  // Mutual exclusion: stop any previous speech
  if (_speaking) stopSpeaking();

  _cancel = false;
  _speaking = true;

  const cfg = loadConfig();
  const segments = splitTextForTTS(text);
  if (segments.length === 0) { _speaking = false; return; }

  const engine = cfg.ttsEngine || 'gtranslate';

  // Explicit whitelist: only known engines route to Worker proxy (gtranslate)
  // Includes legacy values 'free'/'edge' for backward compat with cached localStorage
  const GTRANSLATE_ENGINES = ['gtranslate', 'free', 'edge'];
  if (GTRANSLATE_ENGINES.includes(engine)) {
    try {
      const ok = await speakServer(segments, lang);
      if (ok || _cancel) { _speaking = false; return; }
    } catch (e) {
      console.warn('Server TTS failed, falling back to browser:', e);
    }
    if (_cancel) { _speaking = false; return; }
  } else if (engine !== 'browser') {
    // Unknown engine value — warn and fall through to browser TTS
    console.warn(`Unknown ttsEngine "${engine}", falling back to browser TTS`);
  }

  // Fallback: browser TTS
  await speakBrowser(segments, lang);
  _speaking = false;
}
