import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DrawApiClient, generateW3CTraceParent } from './api.js';

describe('Draw API Client & Distributed Tracing (Issue #76, #88)', () => {
  it('generates standard W3C traceparent headers', () => {
    const { traceParent, traceId, spanId } = generateW3CTraceParent();
    assert.strictEqual(traceId.length, 32);
    assert.match(traceId, /^[0-9a-f]{32}$/);
    assert.strictEqual(spanId.length, 16);
    assert.match(spanId, /^[0-9a-f]{16}$/);
    assert.match(traceParent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('returns an error if submitted batch is empty', async () => {
    const client = new DrawApiClient();
    const result = await client.submitDraw([]);
    assert.ok('error' in result);
    assert.strictEqual(result.error, 'No pixels to draw.');
  });

  it('handles simulated offline / development fetch fallback smoothly with trace context', async () => {
    const client = new DrawApiClient('http://localhost:99999'); // Unreachable port
    const result = await client.submitDraw([{ x: 10, y: 10, color: '#ff0000' }], 'user_token');
    assert.ok('status' in result);
    assert.strictEqual(result.status, 'accepted');
    assert.ok(result.correlationId);
    assert.ok(result.traceId);
    assert.ok(result.spanId);
  });

  it('initializes with custom baseUrl', () => {
    const client = new DrawApiClient('https://custom-gateway.cloud/api');
    assert.ok(client);
  });
});
