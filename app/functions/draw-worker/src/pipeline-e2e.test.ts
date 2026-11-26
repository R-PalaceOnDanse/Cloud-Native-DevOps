/**
 * Pipeline contract test (Issue #143): the envelope published by the web proxy, delivered by a Pub/Sub
 * push subscription, is processed by the worker and lands in the store with its author and timestamp.
 * The same correlation ID is answered back. The live test against GCP is in docs/serverless.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawWorkerHandler } from './index.js';
import { ChunkStore } from './chunk-store.js';
import { WorkerRateLimiter } from './rate-limiter.js';
import type { DiscordApiClient } from './discord-api.js';

test('web proxy envelope -> Pub/Sub push -> worker -> store', async () => {
  const canvas = new ChunkStore();
  const handler = createDrawWorkerHandler(() => ({
    canvas,
    rateLimiter: new WorkerRateLimiter(),
    snapshots: { save: async () => {} },
    discord: {} as DiscordApiClient,
  }));

  const correlationId = 'e2e-corr-999';
  const envelope = {
    id: 'evt-proxy-001',
    correlationId,
    type: 'pixel.draw',
    source: 'web',
    timestamp: 1_700_000_000_000,
    data: {
      userId: 'discord:777',
      author: 'WebArtist',
      pixels: [
        { x: 120, y: 150, color: '#ff0000' },
        { x: 121, y: 150, color: '#00ff00' },
        { x: 122, y: 150, color: '#0000ff' },
      ],
    },
  };

  let status = 0;
  let body: any;
  await handler(
    { method: 'POST', headers: {}, body: { message: { data: Buffer.from(JSON.stringify(envelope)).toString('base64'), messageId: 'ps-1' } } } as any,
    {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    } as any
  );

  assert.equal(status, 200);
  assert.equal(body.status, 'processed');
  assert.equal(body.applied, 3);
  assert.equal(body.correlationId, correlationId);
  assert.deepEqual(canvas.getPixel(120, 150), { color: '#ff0000', author: 'WebArtist', timestamp: 1_700_000_000_000 });
  assert.equal(canvas.getPixel(122, 150)?.color, '#0000ff');
});
