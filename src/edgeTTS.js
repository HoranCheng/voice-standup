// ─── Edge TTS (free Microsoft Neural voices, browser-side WebSocket) ─────────
//
// Connects directly to Microsoft Edge Read Aloud WebSocket from the browser.
// No API key needed. Returns an audio Blob (mp3).

const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_WS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

function uuid() {
  return crypto.randomUUID().replaceAll('-', '');
}

function escapeSSML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Synthesize text to mp3 audio using Edge TTS.
 * @param {string} text - Text to speak
 * @param {object} options - { voice, rate, pitch, volume }
 * @returns {Promise<Blob>} - mp3 audio blob
 */
export function edgeTTS(text, {
  voice = 'zh-CN-XiaoxiaoNeural',
  rate = '+0%',
  pitch = '+0Hz',
  volume = '+0%',
} = {}) {
  return new Promise((resolve, reject) => {
    const connId = uuid();
    const ws = new WebSocket(`${EDGE_WS_BASE}?TrustedClientToken=${EDGE_TOKEN}&ConnectionId=${connId}`);
    ws.binaryType = 'arraybuffer';

    const audioChunks = [];
    let done = false;

    const timeout = setTimeout(() => {
      if (!done) {
        ws.close();
        reject(new Error('Edge TTS timeout (30s)'));
      }
    }, 30000);

    ws.onopen = () => {
      // 1. Send speech config
      const speechConfig = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            },
          },
        },
      });

      ws.send(
        `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${speechConfig}`
      );

      // 2. Send SSML
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>` +
        `${escapeSSML(text)}` +
        `</prosody></voice></speak>`;

      ws.send(
        `X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}Z\r\nPath:ssml\r\n\r\n${ssml}`
      );
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('turn.end')) {
          done = true;
          clearTimeout(timeout);
          ws.close();
          const blob = new Blob(audioChunks, { type: 'audio/mpeg' });
          resolve(blob);
        }
      } else {
        // Binary: extract audio after "Path:audio\r\n"
        const data = new Uint8Array(event.data);
        const separator = new TextEncoder().encode('Path:audio\r\n');
        let idx = -1;
        outer: for (let i = 0; i <= data.length - separator.length; i++) {
          for (let j = 0; j < separator.length; j++) {
            if (data[i + j] !== separator[j]) continue outer;
          }
          idx = i + separator.length;
          break;
        }
        if (idx >= 0) {
          audioChunks.push(data.subarray(idx));
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      if (!done) reject(new Error('Edge TTS WebSocket error'));
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      if (!done) {
        // No turn.end received = incomplete synthesis, always reject
        reject(new Error('Edge TTS WebSocket closed without turn.end'));
      }
    };
  });
}
