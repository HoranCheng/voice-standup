/**
 * Voice Standup Worker
 * Routes:
 *   POST /api/chat         — proxy to Claude API
 *   GET  /api/standup/:id  — get today's standup
 *   PUT  /api/standup/:id  — store standup
 *   POST /api/publish      — post directive to Discord webhook
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS
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
        const { messages, system } = await request.json();

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
            system: system || '',
            messages,
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          return json({ error: `Claude API error: ${res.status}`, detail: err }, 502, env, origin);
        }

        const data = await res.json();
        const response = data.content?.[0]?.text || '';
        return json({ response }, 200, env, origin);
      }

      // ─── Get standup ────────────────────────────────────────────────────
      const standupMatch = path.match(/^\/api\/standup\/([a-zA-Z0-9_-]+)$/);
      if (standupMatch) {
        const productId = standupMatch[1];
        const today = new Date().toISOString().slice(0, 10);
        const key = `${productId}:${today}`;

        if (request.method === 'GET') {
          const content = await env.STANDUPS.get(key);
          if (!content) return json({ error: 'No standup for today' }, 404, env, origin);
          return json({ content, productId, date: today }, 200, env, origin);
        }

        if (request.method === 'PUT') {
          const { content } = await request.json();
          // Store with 48h TTL
          await env.STANDUPS.put(key, content, { expirationTtl: 172800 });
          return json({ ok: true, key }, 200, env, origin);
        }
      }

      // ─── Publish to Discord ─────────────────────────────────────────────
      if (path === '/api/publish' && request.method === 'POST') {
        const { productId, content } = await request.json();

        // Look up webhook URL from config
        const webhookUrl = env[`WEBHOOK_${productId.toUpperCase().replace(/-/g, '_')}`];
        if (!webhookUrl) {
          return json({ error: `No webhook configured for product: ${productId}` }, 400, env, origin);
        }

        const discordRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: content.length > 2000
              ? content.slice(0, 1997) + '…'
              : content,
            username: '早会助手',
          }),
        });

        if (!discordRes.ok) {
          return json({ error: `Discord webhook error: ${discordRes.status}` }, 502, env, origin);
        }

        return json({ ok: true }, 200, env, origin);
      }

      return json({ error: 'Not found' }, 404, env, origin);
    } catch (e) {
      return json({ error: e.message }, 500, env, origin);
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
