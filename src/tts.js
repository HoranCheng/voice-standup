// ─── Text-to-Speech (Browser + ElevenLabs) ──────────────────────────────────

import { ttsElevenLabs } from './api';
import { loadConfig } from './config';

let _speaking = false;
let _cancel = false;
let _currentAudio = null; // for ElevenLabs Audio element

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
  if (!isTTSSupported()) return;
  const utt = new SpeechSynthesisUtterance('');
  utt.volume = 0;
  window.speechSynthesis.speak(utt);
}

/**
 * Wait for voices to load (async-safe, no listener leaks).
 */
function waitForVoices() {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) { resolve(voices); return; }
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    // Timeout fallback — some browsers never fire voiceschanged
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    }, 2000);
  });
}

/**
 * Speak text using ElevenLabs via Worker proxy. Returns true if successful.
 */
async function speakElevenLabs(text) {
  const blob = await ttsElevenLabs(text);
  if (!blob || _cancel) return false;

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

/**
 * Speak text. Tries ElevenLabs first (if configured), falls back to browser TTS.
 * Splits long text into chunks to avoid the Chrome/Safari ~15s cutoff.
 */
export async function speak(text, lang = 'zh-CN') {
  if (!text) return;
  _cancel = false;
  _speaking = true;

  // Try ElevenLabs first if configured
  const cfg = loadConfig();
  if (cfg.ttsEngine === 'elevenlabs') {
    try {
      const ok = await speakElevenLabs(text);
      if (ok && !_cancel) {
        _speaking = false;
        return;
      }
    } catch (e) {
      console.warn('ElevenLabs TTS failed, falling back to browser:', e);
    }
    if (_cancel) { _speaking = false; return; }
  }

  // Fallback: browser TTS
  if (!isTTSSupported()) { _speaking = false; return; }

  const voices = await waitForVoices();
  const zhVoice = voices.find(v => v.lang.startsWith('zh')) ||
                  voices.find(v => v.lang.startsWith('cmn'));

  // iOS keep-alive: prevents synthesis from pausing on screen lock
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

  // Split by sentence-ending punctuation
  const chunks = text.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) || [text];

  return new Promise((resolve) => {
    let i = 0;
    function next() {
      if (_cancel || i >= chunks.length) {
        clearInterval(keepAlive);
        _speaking = false;
        resolve();
        return;
      }
      const utt = new SpeechSynthesisUtterance(chunks[i].trim());
      utt.lang = lang;
      utt.rate = 1.1;
      utt.pitch = 1.0;
      if (zhVoice) utt.voice = zhVoice;

      utt.onend = () => { i++; next(); };
      utt.onerror = () => { i++; next(); };
      window.speechSynthesis.speak(utt);
    }
    next();
  });
}
