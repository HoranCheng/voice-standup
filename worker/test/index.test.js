import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Worker module
const worker = await import('../src/index.js');

function makeRequest(path, method = 'GET', body = null, headers = {}) {
  return new Request(`https://test.workers.dev${path}`, {
    method,
    headers: {
      'Authorization': 'Bearer test-token',
      'Content-Type': 'application/json',
      'Origin': 'https://horancheng.github.io',
      ...headers,
    },
    body: body ? JSON.stringify(body) : null,
  });
}

const mockEnv = {
  AUTH_TOKEN: 'test-token',
  CLAUDE_API_KEY: 'sk-test',
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  ALLOWED_ORIGIN: 'https://horancheng.github.io',
  ALLOW_CLIENT_SYSTEM: 'false',
  SYSTEM_PROMPT: 'You are a test assistant.',
  WEBHOOK_RECEIPT_RENAMER: 'https://discord.com/api/webhooks/test',
  STANDUPS: {
    get: vi.fn(),
    put: vi.fn(),
  },
};

describe('Worker Auth', () => {
  it('rejects requests without auth token', async () => {
    const req = new Request('https://test.workers.dev/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong token', async () => {
    const req = makeRequest('/api/chat', 'POST', { messages: [] }, {
      'Authorization': 'Bearer wrong-token',
    });
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(401);
  });
});

describe('Worker /api/chat', () => {
  it('rejects non-array messages', async () => {
    const req = makeRequest('/api/chat', 'POST', { messages: 'not an array' });
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON', async () => {
    const req = new Request('https://test.workers.dev/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: 'not json',
    });
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(400);
  });

  it('caps message count and content length', async () => {
    // Create 100 messages with 10K chars each
    const messages = Array(100).fill(null).map(() => ({
      role: 'user',
      content: 'x'.repeat(10000),
    }));

    // Mock fetch for Claude API
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: 'response' }] }),
    });

    const req = makeRequest('/api/chat', 'POST', { messages });
    const res = await worker.default.fetch(req, mockEnv);

    if (res.ok) {
      // Check that fetch was called with capped messages
      const call = global.fetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.messages.length).toBeLessThanOrEqual(50);
      body.messages.forEach(m => {
        expect(m.content.length).toBeLessThanOrEqual(8000);
      });
    }
  });

  it('sanitizes message roles', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: 'ok' }] }),
    });

    const req = makeRequest('/api/chat', 'POST', {
      messages: [{ role: 'system', content: 'injected system' }],
    });
    const res = await worker.default.fetch(req, mockEnv);

    if (res.ok) {
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.messages[0].role).toBe('user'); // system → user
    }
  });
});

describe('Worker /api/standup', () => {
  it('validates productId format', async () => {
    const req = makeRequest('/api/standup/../etc/passwd');
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(404); // regex won't match
  });

  it('returns 404 when no standup exists', async () => {
    mockEnv.STANDUPS.get.mockResolvedValueOnce(null);
    const req = makeRequest('/api/standup/test-product');
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(404);
  });

  it('stores standup with PUT', async () => {
    mockEnv.STANDUPS.put.mockResolvedValueOnce(undefined);
    const req = makeRequest('/api/standup/test-product', 'PUT', { content: 'standup text' });
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    expect(mockEnv.STANDUPS.put).toHaveBeenCalled();
  });
});

describe('Worker /api/publish', () => {
  it('validates productId', async () => {
    const req = makeRequest('/api/publish', 'POST', { productId: '', content: 'test' });
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown product webhook', async () => {
    const req = makeRequest('/api/publish', 'POST', { productId: 'unknown-product', content: 'test' });
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(400);
  });
});

describe('Worker CORS', () => {
  it('handles OPTIONS preflight', async () => {
    const req = new Request('https://test.workers.dev/api/chat', {
      method: 'OPTIONS',
      headers: { 'Origin': 'https://horancheng.github.io' },
    });
    const res = await worker.default.fetch(req, mockEnv);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://horancheng.github.io');
  });
});
