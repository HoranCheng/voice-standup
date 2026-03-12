// ─── Text-to-Speech ──────────────────────────────────────────────────────────

let _speaking = false;
let _cancel = false;

export function isTTSSupported() {
  return 'speechSynthesis' in window;
}

export function stopSpeaking() {
  _cancel = true;
  window.speechSynthesis?.cancel();
  _speaking = false;
}

export function isSpeaking() { return _speaking; }

/**
 * Speak text using browser TTS.
 * Splits long text into chunks to avoid the Chrome/Safari ~15s cutoff.
 */
export function speak(text, lang = 'zh-CN') {
  return new Promise((resolve) => {
    if (!text || !isTTSSupported()) { resolve(); return; }
    _cancel = false;
    _speaking = true;

    // Split by sentence-ending punctuation
    const chunks = text.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) || [text];

    let i = 0;
    function next() {
      if (_cancel || i >= chunks.length) {
        _speaking = false;
        resolve();
        return;
      }
      const utt = new SpeechSynthesisUtterance(chunks[i].trim());
      utt.lang = lang;
      utt.rate = 1.1;
      utt.pitch = 1.0;

      // Try to find a Chinese voice
      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang.startsWith('zh')) ||
                      voices.find(v => v.lang.startsWith('cmn'));
      if (zhVoice) utt.voice = zhVoice;

      utt.onend = () => { i++; next(); };
      utt.onerror = () => { i++; next(); };
      window.speechSynthesis.speak(utt);
    }

    // Voices might load async
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => next();
    } else {
      next();
    }
  });
}
