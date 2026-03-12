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

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system,
            messages: safeMessages,
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          console.error('Claude API error:', res.status, err);
          return json({ error: `AI service error (${res.status})` }, 502, env, origin);
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

        const today = new Date().toISOString().slice(0, 10);
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

        const safeContent = String(content ?? '').slice(0, 2000);
        const discordRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: safeContent,
            username: '早会助手',
          }),
        });

        if (!discordRes.ok) {
          console.error('Discord webhook error:', discordRes.status);
          return json({ error: `Publish failed (${discordRes.status})` }, 502, env, origin);
        }

        return json({ ok: true }, 200, env, origin);
      }

      return json({ error: 'Not found' }, 404, env, origin);
    } catch (e) {
      console.error('Worker error:', e);
      return json({ error: 'Internal error' }, 500, env, origin);
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
