/**
 * Voice Standup Worker
 * Routes:
 *   POST /api/chat         — proxy to Claude API
 *   GET  /api/standup/:id  — get today's standup
 *   PUT  /api/standup/:id  — store standup
 *   POST /api/publish      — post directive to Discord webhook
 */

const MAX_MESSAGES = 50;
const MAX_CONTENT_LEN = 8000;
const PRODUCT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const TIMEZONE = 'Australia/Melbourne';

/** Get today's date in AEST/AEDT (YYYY-MM-DD) */
function todayAEST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}
const DISCORD_CHAR_LIMIT = 2000;

/**
 * Send a message to a Discord webhook.
 * If content exceeds 2000 chars, splits into multiple messages.
 */
async function sendToWebhook(webhookUrl, content, options = {}) {
  const { username = '早会助手', productId = '', prefix = '' } = options;
  const fullContent = prefix ? `${prefix}\n\n${content}` : content;

  if (fullContent.length <= DISCORD_CHAR_LIMIT) {
    return fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: fullContent, username }),
    });
  }

  // Long content: split into chunks and send sequentially
  // Discord allows 2000 chars per message; we use 1900 to leave room for chunk headers
  const CHUNK_SIZE = 1900;
  const chunks = [];
  for (let i = 0; i < fullContent.length; i += CHUNK_SIZE) {
    chunks.push(fullContent.slice(i, i + CHUNK_SIZE));
  }

  let lastRes = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunkHeader = chunks.length > 1 ? `**(${i + 1}/${chunks.length})**\n` : '';
    const chunkContent = chunkHeader + chunks[i];

    lastRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: chunkContent, username }),
    });

    if (!lastRes.ok) return lastRes;

    // Small delay between messages to avoid rate limit
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return lastRes;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(env, origin);
    }

    // Auth check
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token !== env.AUTH_TOKEN) {
      return json({ error: 'Unauthorized' }, 401, env, origin);
    }

    try {
      const path = url.pathname;

      // ─── Chat (Claude API proxy) ────────────────────────────────────────
      if (path === '/api/chat' && request.method === 'POST') {
        let body;
        try { body = await request.json(); }
        catch { return json({ error: 'Invalid JSON' }, 400, env, origin); }

        if (!body || !Array.isArray(body.messages)) {
          return json({ error: 'Invalid request: messages array required' }, 400, env, origin);
        }

        // Sanitize messages — cap count and length, validate roles
        const safeMessages = body.messages.slice(0, MAX_MESSAGES).map(m => ({
          role: ['user', 'assistant'].includes(m.role) ? m.role : 'user',
          content: String(m.content ?? '').slice(0, MAX_CONTENT_LEN),
        }));

        // System prompt: use server-controlled default, allow client override only if env allows
        const system = env.ALLOW_CLIENT_SYSTEM === 'true'
          ? String(body.system || env.SYSTEM_PROMPT || '').slice(0, MAX_CONTENT_LEN)
          : (env.SYSTEM_PROMPT || '');

        // Build request body — omit system if empty (Claude API rejects empty string)
        // Use env.CLAUDE_MODEL if set, otherwise default to haiku 4.5
        const model = env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
        const requestBody = {
            model,
            max_tokens: 4096,
            messages: safeMessages,
        };
        if (system) requestBody.system = system;

        // 60s timeout (Cloudflare Workers paid plan allows up to 30s CPU;
        // but wall-clock time for subrequests is not limited the same way)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const err = await res.text();
          console.error('Claude API error:', res.status, err);
          console.error('Claude API request body:', JSON.stringify(requestBody));
          return json({ error: `AI service error (${res.status})`, detail: err }, 502, env, origin);
        }

        const data = await res.json();
        const response = data.content?.[0]?.text || '';
        return json({ response }, 200, env, origin);
      }

      // ─── Standup CRUD ───────────────────────────────────────────────────
      const standupMatch = path.match(/^\/api\/standup\/([a-zA-Z0-9_-]+)$/);
      if (standupMatch) {
        const productId = standupMatch[1];
        if (!PRODUCT_ID_RE.test(productId)) {
          return json({ error: 'Invalid productId' }, 400, env, origin);
        }

        // Use AEST date to match Henry's local calendar day
        // (UTC 19:10 = AEST 06:10 next day — without this fix, PUT at 6am AEST
        //  would use yesterday's UTC date, causing GET later to miss it)
        const today = todayAEST();
        const key = `${productId}:${today}`;

        if (request.method === 'GET') {
          const content = await env.STANDUPS.get(key);
          if (!content) return json({ error: 'No standup for today' }, 404, env, origin);
          return json({ content, productId, date: today }, 200, env, origin);
        }

        if (request.method === 'PUT') {
          let body;
          try { body = await request.json(); }
          catch { return json({ error: 'Invalid JSON' }, 400, env, origin); }

          const content = String(body.content ?? '').slice(0, 20000);
          await env.STANDUPS.put(key, content, { expirationTtl: 172800 });
          return json({ ok: true, key }, 200, env, origin);
        }
      }

      // ─── Publish to Command Channel ──────────────────────────────────────
      if (path === '/api/publish-command' && request.method === 'POST') {
        let body;
        try { body = await request.json(); }
        catch { return json({ error: 'Invalid JSON' }, 400, env, origin); }

        const { productId, content } = body;
        if (!productId || !PRODUCT_ID_RE.test(productId)) {
          return json({ error: 'Invalid productId' }, 400, env, origin);
        }

        const webhookUrl = env.WEBHOOK_COMMAND;
        if (!webhookUrl) {
          return json({ error: 'Command webhook not configured' }, 400, env, origin);
        }

        const safeContent = String(content ?? '');
        const discordRes = await sendToWebhook(webhookUrl, safeContent, {
          productId,
          prefix: `📋 **${productId} — 指导意见**`,
        });

        if (!discordRes.ok) {
          console.error('Command webhook error:', discordRes.status);
          return json({ error: `Command publish failed (${discordRes.status})` }, 502, env, origin);
        }

        return json({ ok: true }, 200, env, origin);
      }

      // ─── Publish to Discord ─────────────────────────────────────────────
      if (path === '/api/publish' && request.method === 'POST') {
        let body;
        try { body = await request.json(); }
        catch { return json({ error: 'Invalid JSON' }, 400, env, origin); }

        const { productId, content } = body;
        if (!productId || !PRODUCT_ID_RE.test(productId)) {
          return json({ error: 'Invalid productId' }, 400, env, origin);
        }

        const webhookUrl = env[`WEBHOOK_${productId.toUpperCase().replace(/-/g, '_')}`];
        if (!webhookUrl) {
          return json({ error: `No webhook configured for product: ${productId}` }, 400, env, origin);
        }

        const safeContent = String(content ?? '');
        const discordRes = await sendToWebhook(webhookUrl, safeContent, { productId });

        if (!discordRes.ok) {
          console.error('Discord webhook error:', discordRes.status);
          return json({ error: `Publish failed (${discordRes.status})` }, 502, env, origin);
        }

        return json({ ok: true }, 200, env, origin);
      }

      // ─── TTS (ElevenLabs proxy) ─────────────────────────────────────────
      if (path === '/api/tts' && request.method === 'POST') {
        const elevenKey = env.ELEVENLABS_API_KEY;
        if (!elevenKey) {
          return json({ error: 'TTS not configured' }, 400, env, origin);
        }

        let body;
        try { body = await request.json(); }
        catch { return json({ error: 'Invalid JSON' }, 400, env, origin); }

        const text = String(body.text ?? '').slice(0, 5000);
        if (!text) return json({ error: 'text required' }, 400, env, origin);

        const voiceId = body.voiceId || env.ELEVENLABS_VOICE || 'pFZP5JQG7iQjIQuC4Bku'; // Lily default
        const modelId = body.modelId || 'eleven_multilingual_v2';

        const ttsRes = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': elevenKey,
            },
            body: JSON.stringify({
              text,
              model_id: modelId,
              voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
          }
        );

        if (!ttsRes.ok) {
          const err = await ttsRes.text();
          console.error('ElevenLabs TTS error:', ttsRes.status, err);
          return json({ error: `TTS error (${ttsRes.status})` }, 502, env, origin);
        }

        // Stream audio back to client
        return new Response(ttsRes.body, {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            ...corsHeaders(env, origin),
          },
        });
      }

      return json({ error: 'Not found' }, 404, env, origin);
    } catch (e) {
      console.error('Worker error:', e.message, e.stack);
      return json({ error: 'Internal error', detail: e.message }, 500, env, origin);
    }
  },
};

function json(data, status, env, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env, origin),
    },
  });
}

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim());
  const allow = allowed.includes(origin) || allowed.includes('*') ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function corsResponse(env, origin) {
  return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
}
