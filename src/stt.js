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
  let lastInterim = ''; // Track interim for fallback when stop() is called before isFinal

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalTranscript += t;
        lastInterim = '';
        onResult?.({ final: finalTranscript, interim: '', isFinal: true });
      } else {
        interim += t;
        lastInterim = interim;
        onResult?.({ final: finalTranscript, interim, isFinal: false });
      }
    }
  };

  rec.onerror = (e) => {
    if (e.error === 'aborted') return;

    // Classify STT errors for user-friendly messages (especially driving mode)
    const errorMessages = {
      'no-speech': null, // silent — normal in driving mode pauses
      'audio-capture': '无法访问麦克风，请检查权限设置',
      'not-allowed': '麦克风权限被拒绝，请在设置中允许',
      'network': '网络连接异常，语音识别暂时不可用',
      'service-not-allowed': '语音识别服务不可用',
      'language-not-supported': '当前语言不支持语音识别',
    };

    const msg = errorMessages[e.error];
    if (msg === null) return; // explicitly silenced
    onError?.(msg || `语音识别错误: ${e.error}`, e.error);
  };

  rec.onend = () => {
    onEnd?.();
  };

  return {
    start() { finalTranscript = ''; lastInterim = ''; rec.start(); },
    stop() { rec.stop(); },
    abort() { rec.abort(); },
    getTranscript() { return finalTranscript || lastInterim; }, // fallback to interim if final not yet fired
    resetTranscript() { finalTranscript = ''; lastInterim = ''; },
    /** Stop and wait for final transcript (resolves after onend fires) */
    stopAndWait(timeoutMs = 2000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve(finalTranscript?.trim() || '');
        }, timeoutMs);

        const prevOnEnd = rec.onend;
        rec.onend = () => {
          clearTimeout(timer);
          prevOnEnd?.();
          resolve(finalTranscript?.trim() || '');
        };
        rec.stop();
      });
    },
  };
}
