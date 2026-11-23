import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import type { Request, Response } from '@google-cloud/functions-framework';
import { createDrawProxyHandler } from './index.js';
import { MockEventPublisher } from './publisher.js';

function createMockResponse() {
  const res: Partial<Response> & {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  } = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this as Response;
    },
    json(data: unknown) {
      this.body = data;
      return this as Response;
    },
  };
  return res;
}

function createMockRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Request {
  const headers = options.headers || {};
  return {
    method: options.method || 'POST',
    header(name: string) {
      return headers[name] || headers[name.toLowerCase()];
    },
    body: options.body || {},
  } as unknown as Request;
}

describe('Web Draw Proxy Cloud Function (Issue #76)', () => {
  let publisher: MockEventPublisher;
  let handler: ReturnType<typeof createDrawProxyHandler>;

  beforeEach(() => {
    publisher = new MockEventPublisher();
    handler = createDrawProxyHandler(publisher, 'pixel-draw-events');
  });

  it('rejects non-POST methods with 405 Method Not Allowed', async () => {
    const req = createMockRequest({ method: 'GET' });
    const res = createMockResponse();

    await handler(req, res as unknown as Response);

    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.headers['Allow'], 'POST');
  });

  it('rejects missing or invalid authentication token with 401 Unauthorized', async () => {
    const req = createMockRequest({
      method: 'POST',
      body: {
        pixels: [{ x: 10, y: 10, color: '#ff0000' }],
      },
    });
    const res = createMockResponse();

    await handler(req, res as unknown as Response);

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(publisher.publishedEvents.length, 0);
  });

  it('rejects invalid or out-of-bounds pixel coordinates with 400 Bad Request', async () => {
    const req = createMockRequest({
      method: 'POST',
      headers: { Authorization: 'Bearer user_test_12345678' },
      body: {
        pixels: [
          { x: 10000, y: 50, color: '#ff0000' }, // Out of bounds [0..9999]
        ],
      },
    });
    const res = createMockResponse();

    await handler(req, res as unknown as Response);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(publisher.publishedEvents.length, 0);
  });

  it('rejects invalid hex color format with 400 Bad Request', async () => {
    const req = createMockRequest({
      method: 'POST',
      headers: { Authorization: 'Bearer user_test_12345678' },
      body: {
        pixels: [
          { x: 50, y: 50, color: 'blue' }, // Invalid format: expected #rrggbb
        ],
      },
    });
    const res = createMockResponse();

    await handler(req, res as unknown as Response);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(publisher.publishedEvents.length, 0);
  });

  it('rejects batches exceeding 100 pixels with 400 Bad Request', async () => {
    const pixels = Array.from({ length: 101 }, (_, i) => ({
      x: i,
      y: 0,
      color: '#ff0000',
    }));

    const req = createMockRequest({
      method: 'POST',
      headers: { Authorization: 'Bearer user_test_12345678' },
      body: { pixels },
    });
    const res = createMockResponse();

    await handler(req, res as unknown as Response);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(publisher.publishedEvents.length, 0);
  });

  it('accepts a valid stroke batch, publishes event to Pub/Sub with source "web", and returns 202 Accepted', async () => {
    const customCorrelationId = 'trace-web-test-999';
    const req = createMockRequest({
      method: 'POST',
      headers: {
        Authorization: 'Bearer user_test_12345678',
        'X-Correlation-ID': customCorrelationId,
      },
      body: {
        pixels: [
          { x: 120, y: 340, color: '#00ff00' },
          { x: 121, y: 340, color: '#00ff00' },
        ],
      },
    });
    const res = createMockResponse();

    await handler(req, res as unknown as Response);

    // Verify fast acknowledgement
    assert.strictEqual(res.statusCode, 202);
    assert.strictEqual(res.headers['X-Correlation-ID'], customCorrelationId);
    assert.ok(typeof res.headers['traceparent'] === 'string' && res.headers['traceparent'].startsWith('00-'));

    // Verify published Pub/Sub event envelope
    assert.strictEqual(publisher.publishedEvents.length, 1);
    const published = publisher.publishedEvents[0]!;
    assert.strictEqual(published.topic, 'pixel-draw-events');

    const envelope = published.event;
    assert.strictEqual(envelope.type, 'pixel.draw');
    assert.strictEqual(envelope.source, 'web');
    assert.strictEqual(envelope.correlationId, customCorrelationId);
    assert.ok(typeof envelope.traceParent === 'string' && envelope.traceParent.startsWith('00-'));
    assert.strictEqual((envelope.data as { userId: string }).userId, 'user_test_12345678');
    assert.strictEqual((envelope.data as { pixels: unknown[] }).pixels.length, 2);
  });

  it('inherits and propagates incoming W3C traceparent header (Issue #88)', async () => {
    const incomingTrace = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const req = createMockRequest({
      method: 'POST',
      headers: {
        Authorization: 'Bearer user_test_trace',
        traceparent: incomingTrace,
      },
      body: {
        pixels: [{ x: 10, y: 10, color: '#ff0000' }],
      },
    });
    const res = createMockResponse();

    await handler(req, res as unknown as Response);

    assert.strictEqual(res.statusCode, 202);
    // Trace ID must match the incoming trace ID
    assert.ok(res.headers['traceparent']!.includes('4bf92f3577b34da6a3ce929d0e0e4736'));

    const published = publisher.publishedEvents[0]!;
    assert.ok(published.event.traceParent!.includes('4bf92f3577b34da6a3ce929d0e0e4736'));
  });
});
