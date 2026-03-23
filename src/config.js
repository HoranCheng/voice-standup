// ─── Configuration ────────────────────────────────────────────────────────────
// All sensitive values stored in localStorage, set via Settings panel.
// Worker URL is the only public value.

const LS_KEY = 'vs-config';

const DEFAULT = {
  workerUrl: '', // Cloudflare Worker proxy URL
  authToken: '', // Bearer token for Worker auth
  products: [],  // [{ id, name, discordChannelId, webhookUrl }]
  ttsEngine: 'gtranslate', // 'gtranslate' | 'browser' | 'elevenlabs'
  ttsVoice: 'zh-CN-XiaoxiaoNeural',
  elevenLabsKey: '',
  elevenLabsVoice: 'Rachel',
  lang: 'zh-CN',
};

export function loadConfig() {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') };
  } catch { return { ...DEFAULT }; }
}

export function saveConfig(cfg) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}
