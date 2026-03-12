// ─── Text-to-Speech ──────────────────────────────────────────────────────────

let _speaking = false;
let _cancel = false;

export function isTTSSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function stopSpeaking() {
  _cancel = true;
  window.speechSynthesis?.cancel();
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
 * Speak text using browser TTS.
 * Splits long text into chunks to avoid the Chrome/Safari ~15s cutoff.
 */
export async function speak(text, lang = 'zh-CN') {
  if (!text || !isTTSSupported()) return;
  _cancel = false;
  _speaking = true;

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
