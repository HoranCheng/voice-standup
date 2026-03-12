// ─── Speech-to-Text via Web Speech API ───────────────────────────────────────

function getSpeechRecognition() {
  return typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
}

export function isSTTSupported() {
  return !!getSpeechRecognition();
}

export function createRecognizer(lang = 'zh-CN', { onResult, onEnd, onError }) {
  const SR = getSpeechRecognition();
  if (!SR) {
    onError?.('Speech recognition not supported in this browser');
    return null;
  }

  const rec = new SR();
  rec.lang = lang;
  rec.continuous = false; // iOS Safari ignores continuous:true; use push-to-talk model
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
    if (e.error === 'no-speech' || e.error === 'aborted') return;
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
