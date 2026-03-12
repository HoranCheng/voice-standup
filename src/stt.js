// ─── Speech-to-Text via Web Speech API ───────────────────────────────────────

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isSTTSupported() {
  return !!SpeechRecognition;
}

export function createRecognizer(lang = 'zh-CN', { onResult, onEnd, onError }) {
  if (!SpeechRecognition) {
    onError?.('Speech recognition not supported in this browser');
    return null;
  }

  const rec = new SpeechRecognition();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalTranscript = '';

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalTranscript += t;
        onResult?.({ final: finalTranscript, interim: '', isFinal: true });
      } else {
        interim += t;
        onResult?.({ final: finalTranscript, interim, isFinal: false });
      }
    }
  };

  rec.onerror = (e) => {
    if (e.error === 'no-speech') return; // Ignore silence
    onError?.(e.error);
  };

  rec.onend = () => {
    onEnd?.();
  };

  return {
    start() { finalTranscript = ''; rec.start(); },
    stop() { rec.stop(); },
    abort() { rec.abort(); },
    getTranscript() { return finalTranscript; },
    resetTranscript() { finalTranscript = ''; },
  };
}
