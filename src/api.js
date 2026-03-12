// ─── Worker API Client ───────────────────────────────────────────────────────

import { loadConfig } from './config';

function headers() {
  const cfg = loadConfig();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.authToken}`,
  };
}

function url(path) {
  const cfg = loadConfig();
  return `${cfg.workerUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Send a message to Claude and get a response.
 * messages: [{ role: 'user'|'assistant', content: '...' }]
 * systemPrompt: string
 */
export async function chat(messages, systemPrompt) {
  const res = await fetch(url('/api/chat'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ messages, system: systemPrompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Chat failed (${res.status})`);
  }
  const data = await res.json();
  return data.response;
}

/**
 * Fetch today's standup for a product.
 */
export async function getStandup(productId) {
  const res = await fetch(url(`/api/standup/${productId}`), {
    headers: headers(),
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Standup fetch failed (${res.status})`);
  }
  const data = await res.json();
  return data.content;
}

/**
 * Publish a directive to Discord via webhook.
 */
export async function publishDirective(productId, content) {
  const res = await fetch(url('/api/publish'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ productId, content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Publish failed (${res.status})`);
  }
  return await res.json();
}

/**
 * Store standup content (called by OpenClaw cron or manually).
 */
export async function putStandup(productId, content) {
  const res = await fetch(url(`/api/standup/${productId}`), {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Standup put failed (${res.status})`);
  return await res.json();
}
