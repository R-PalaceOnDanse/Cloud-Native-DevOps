/**
 * End-to-End Pipeline Integration Test.
 * Validates Proxy Contract -> Pub/Sub Message -> Worker -> Transactional Chunk Store -> Real-time Deltas.
 * Fulfills Issue #143 (C06 §8 Hands-on 3).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawWorkerHandler } from './index.js';
import { ChunkStore } from './chunk-store.js';
import { WorkerRateLimiter } from './rate-limiter.js';

test('End-to-End Event Pipeline (Proxy -> Pub/Sub -> Worker -> Chunk Store -> Deltas)', async (t) => {
  await t.test('executes complete asynchronous draw flow and traces correlation ID end-to-end', async () => {
    const chunkStore = new ChunkStore();
    const rateLimiter = new WorkerRateLimiter();
    const correlationId = 'test-e2e-trace-id-999';

    // 1. Proxy Contract: EventEnvelope created by Web Draw Proxy
    const proxyEnvelope = {
      id: 'evt-proxy-draw-001',
      correlationId,
      type: 'pixel.draw',
      source: 'web',
      timestamp: Date.now(),
      data: {
        userId: 'web-user-777',
        author: 'WebArtist#1234',
        pixels: [
          { x: 120, y: 150, color: '#ff0000' },
          { x: 121, y: 150, color: '#00ff00' },
          { x: 122, y: 150, color: '#0000ff' },
        ],
      },
    };

    // 2. Pub/Sub Message Delivery to Push Endpoint
    const workerHandler = createDrawWorkerHandler({
      chunkStore,
      rateLimiter,
    });

    const pubSubPushReq = {
      method: 'POST',
      body: {
        message: {
          data: Buffer.from(JSON.stringify(proxyEnvelope)).toString('base64'),
          attributes: { correlationId, eventType: 'pixel.draw', eventSource: 'web' },
          messageId: 'ps-msg-001',
        },
      },
      headers: {},
    } as any;

    let workerStatusCode = 0;
    let workerResponseJson: any = null;

    const workerRes = {
      status(code: number) {
        workerStatusCode = code;
        return this;
      },
      json(data: any) {
        workerResponseJson = data;
        return this;
      },
    } as any;

    // 3. Worker Execution
    await workerHandler(pubSubPushReq, workerRes);

    // Step A: Verify Worker Response
    assert.equal(workerStatusCode, 200);
    assert.equal(workerResponseJson.status, 'processed');
    assert.equal(workerResponseJson.applied, 3);
    assert.equal(workerResponseJson.correlationId, correlationId);

    // Step B: Verify Storage State in Chunk Store
    // (120, 150) -> chunkX = floor(120/64) = 1, chunkY = floor(150/64) = 2 -> chunk_1_2
    const pixel1 = chunkStore.getPixel(120, 150);
    assert.equal(pixel1?.color, '#ff0000');
    assert.equal(pixel1?.author, 'WebArtist#1234');
    assert.equal(pixel1?.epoch, 1);

    const pixel2 = chunkStore.getPixel(121, 150);
    assert.equal(pixel2?.color, '#00ff00');

    const pixel3 = chunkStore.getPixel(122, 150);
    assert.equal(pixel3?.color, '#0000ff');

    // Step C: Verify Delta Document was generated for chunk_1_2
    const deltas = chunkStore.getDeltas('chunk_1_2');
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]?.pixels.length, 3);
    assert.ok(deltas[0]?.expiresAt! > Date.now());
  });
});
