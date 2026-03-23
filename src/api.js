// ─── Worker API Client ───────────────────────────────────────────────────────

import { loadConfig } from './config';

const API_TIMEOUT_MS = 60000; // 60s timeout for Claude API calls

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
 * Fetch with timeout guard — prevents indefinite hangs (especially during driving).
 */
async function fetchWithTimeout(input, init, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('AI 响应超时，请稍后重试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a message to Claude and get a response.
 * messages: [{ role: 'user'|'assistant', content: '...' }]
 * systemPrompt: string
 */
export async function chat(messages, systemPrompt) {
  const res = await fetchWithTimeout(url('/api/chat'), {
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
 * Publish directive to the command channel (for 老顾 to dispatch).
 * Falls back silently if command webhook is not configured.
 */
export async function publishToCommand(productId, content) {
  try {
    const res = await fetchWithTimeout(url('/api/publish-command'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ productId, content }),
    });
    if (!res.ok) {
      console.warn('Command publish failed:', res.status);
      return { ok: false };
    }
    return await res.json();
  } catch (e) {
    console.warn('Command publish error:', e);
    return { ok: false };
  }
}

/**
 * Get TTS audio from Worker proxy.
 * Worker TTS endpoint removed — TTS runs client-side (edgeTTS.js → browser fallback).
 * ttsAudio() is no longer used and has been deleted.
 */

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
