import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawWorkerHandler } from './index.js';
import { ChunkStore } from './chunk-store.js';
import { WorkerRateLimiter } from './rate-limiter.js';
import { SnapshotService } from './snapshot-service.js';
import { DiscordApiClient } from './discord-api.js';

function createMockHttp(body: unknown) {
  let statusCode = 200;
  let responseData: any = null;

  const req = {
    method: 'POST',
    body,
    headers: {},
  } as any;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      responseData = data;
      return this;
    },
    getStatusCode: () => statusCode,
    getResponseData: () => responseData,
  } as any;

  return { req, res };
}

function makePubSubPayload(envelope: unknown, attributes: Record<string, string> = {}) {
  const jsonStr = JSON.stringify(envelope);
  const base64Data = Buffer.from(jsonStr, 'utf8').toString('base64');
  return {
    message: {
      data: base64Data,
      attributes,
      messageId: 'mock-msg-12345',
    },
  };
}

test('Draw Worker Cloud Function (Issues #48, #52, #53, #55, #56, #57, #68, #141, #142)', async (t) => {
  await t.test('rejects missing Pub/Sub message data with 400 Bad Request', async () => {
    const handler = createDrawWorkerHandler();
    const { req, res } = createMockHttp({});

    await handler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.match(res.getResponseData().error, /missing/i);
  });

  await t.test('rejects unparseable JSON message data with 400 Bad Request', async () => {
    const handler = createDrawWorkerHandler();
    const { req, res } = createMockHttp({
      message: { data: Buffer.from('not-json').toString('base64') },
    });

    await handler(req, res);
    assert.equal(res.getStatusCode(), 400);
    assert.match(res.getResponseData().error, /unable to parse/i);
  });

  await t.test('processes valid pixel.draw event, applies pixels transactionally, and creates deltas', async () => {
    const chunkStore = new ChunkStore();
    const rateLimiter = new WorkerRateLimiter();
    let editedResponse = false;

    const mockDiscord = {
      editOriginalResponse: async () => {
        editedResponse = true;
        return true;
      },
      postFollowupWithImage: async () => true,
    } as unknown as DiscordApiClient;

    const handler = createDrawWorkerHandler({
      chunkStore,
      rateLimiter,
      discordClient: mockDiscord,
    });

    const envelope = {
      id: 'evt-draw-001',
      correlationId: 'corr-001',
      type: 'pixel.draw',
      source: 'discord',
      timestamp: Date.now(),
      data: {
        userId: 'user-alice',
        applicationId: 'mock-app-id',
        interactionToken: 'mock-token',
        pixels: [
          { x: 10, y: 20, color: '#ff0000' },
          { x: 11, y: 20, color: '#00ff00' },
        ],
      },
    };

    const { req, res } = createMockHttp(makePubSubPayload(envelope));
    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getResponseData().status, 'processed');
    assert.equal(res.getResponseData().applied, 2);
    assert.equal(res.getResponseData().correlationId, 'corr-001');

    // Verify chunk store state
    const p1 = chunkStore.getPixel(10, 20);
    assert.equal(p1?.color, '#ff0000');
    assert.match(p1?.author || '', /user-alice/);

    const p2 = chunkStore.getPixel(11, 20);
    assert.equal(p2?.color, '#00ff00');

    // Verify delta document created
    const deltas = chunkStore.getDeltas('chunk_0_0');
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]?.pixels.length, 2);

    // Verify Discord response was edited
    assert.equal(editedResponse, true);
  });

  await t.test('rejects draw when canvas is paused by admin', async () => {
    const chunkStore = new ChunkStore();
    chunkStore.setPauseState(true);

    const handler = createDrawWorkerHandler({ chunkStore });
    const envelope = {
      id: 'evt-draw-paused',
      correlationId: 'corr-paused',
      type: 'pixel.draw',
      source: 'web',
      timestamp: Date.now(),
      data: {
        userId: 'user-bob',
        pixels: [{ x: 50, y: 50, color: '#ff0000' }],
      },
    };

    const { req, res } = createMockHttp(makePubSubPayload(envelope));
    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getResponseData().status, 'rejected_paused');
    assert.equal(chunkStore.getPixel(50, 50), undefined);
  });

  await t.test('rejects draw when user rate limit is exceeded', async () => {
    const rateLimiter = new WorkerRateLimiter();
    // Exhaust tokens
    rateLimiter.tryConsume('user-charlie', 20);

    const handler = createDrawWorkerHandler({ rateLimiter });
    const envelope = {
      id: 'evt-draw-rl',
      correlationId: 'corr-rl',
      type: 'pixel.draw',
      source: 'web',
      timestamp: Date.now(),
      data: {
        userId: 'user-charlie',
        pixels: [{ x: 100, y: 100, color: '#ff0000' }],
      },
    };

    const { req, res } = createMockHttp(makePubSubPayload(envelope));
    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getResponseData().status, 'rate_limited');
  });

  await t.test('rejects draw when coordinates are out of bounds', async () => {
    const handler = createDrawWorkerHandler();
    const envelope = {
      id: 'evt-draw-oob',
      correlationId: 'corr-oob',
      type: 'pixel.draw',
      source: 'web',
      timestamp: Date.now(),
      data: {
        userId: 'user-dan',
        pixels: [{ x: 10000, y: 5000, color: '#ff0000' }],
      },
    };

    const { req, res } = createMockHttp(makePubSubPayload(envelope));
    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getResponseData().status, 'invalid_coordinates');
  });

  await t.test('enforces admin authorization for /admin commands (Issue #68 / ADR-0019)', async () => {
    const chunkStore = new ChunkStore();
    const handler = createDrawWorkerHandler({
      chunkStore,
      firestoreAdmins: ['admin-eve'],
    });

    // 1. Non-admin attempt -> unauthorized
    const nonAdminEnvelope = {
      id: 'evt-admin-unauth',
      correlationId: 'corr-unauth',
      type: 'discord.command',
      source: 'discord',
      timestamp: Date.now(),
      data: {
        userId: 'regular-user',
        commandName: 'admin',
        options: { subcommand: 'pause' },
      },
    };

    const { req: req1, res: res1 } = createMockHttp(makePubSubPayload(nonAdminEnvelope));
    await handler(req1, res1);
    assert.equal(res1.getResponseData().status, 'unauthorized');
    assert.equal(chunkStore.getPauseState(), false);

    // 2. Admin attempt -> authorized
    const adminEnvelope = {
      id: 'evt-admin-auth',
      correlationId: 'corr-auth',
      type: 'discord.command',
      source: 'discord',
      timestamp: Date.now(),
      data: {
        userId: 'admin-eve',
        commandName: 'admin',
        options: { subcommand: 'pause' },
      },
    };

    const { req: req2, res: res2 } = createMockHttp(makePubSubPayload(adminEnvelope));
    await handler(req2, res2);
    assert.equal(res2.getResponseData().status, 'admin_pause_success');
    assert.equal(chunkStore.getPauseState(), true);
  });

  await t.test('admin clear increments epoch and invalidates old epoch pixels (Issue #57)', async () => {
    const chunkStore = new ChunkStore();
    chunkStore.applyDraw('e1', [{ x: 5, y: 5, color: '#ff0000' }], 'user1');
    assert.ok(chunkStore.getPixel(5, 5));

    const handler = createDrawWorkerHandler({
      chunkStore,
      firestoreAdmins: ['admin-super'],
    });

    const clearEnvelope = {
      id: 'evt-clear',
      correlationId: 'corr-clear',
      type: 'discord.command',
      source: 'discord',
      timestamp: Date.now(),
      data: {
        userId: 'admin-super',
        commandName: 'admin',
        options: { subcommand: 'clear' },
      },
    };

    const { req, res } = createMockHttp(makePubSubPayload(clearEnvelope));
    await handler(req, res);

    assert.equal(res.getResponseData().status, 'admin_clear_success');
    assert.equal(chunkStore.getEpoch(), 2);
    // Old epoch pixel is now treated as cleared
    assert.equal(chunkStore.getPixel(5, 5), undefined);
  });

  await t.test('handles /get command and produces PNG follow-up (Issue #55)', async () => {
    const chunkStore = new ChunkStore();
    let sentFollowup = false;

    const mockDiscord = {
      editOriginalResponse: async () => true,
      postFollowupWithImage: async (appId: string, token: string, buf: Buffer) => {
        sentFollowup = true;
        // Verify buffer is valid PNG signature: 137 80 78 71 (0x89 'P' 'N' 'G')
        assert.equal(buf[0], 0x89);
        assert.equal(buf[1], 0x50);
        assert.equal(buf[2], 0x4e);
        assert.equal(buf[3], 0x47);
        return true;
      },
    } as unknown as DiscordApiClient;

    const handler = createDrawWorkerHandler({
      chunkStore,
      discordClient: mockDiscord,
    });

    const getEnvelope = {
      id: 'evt-get',
      correlationId: 'corr-get',
      type: 'discord.command',
      source: 'discord',
      timestamp: Date.now(),
      data: {
        userId: 'user-viewer',
        commandName: 'get',
        applicationId: 'app-1',
        interactionToken: 'tok-1',
      },
    };

    const { req, res } = createMockHttp(makePubSubPayload(getEnvelope));
    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getResponseData().status, 'get_success');
    assert.equal(sentFollowup, true);
  });

  await t.test('handles /snapshot command and generates signed URL (Issue #56)', async () => {
    let responseText = '';
    const mockDiscord = {
      editOriginalResponse: async (appId: string, token: string, payload: { content?: string }) => {
        responseText = payload.content || '';
        return true;
      },
      postFollowupWithImage: async () => true,
    } as unknown as DiscordApiClient;

    const handler = createDrawWorkerHandler({
      firestoreAdmins: ['snapshot-admin'],
      discordClient: mockDiscord,
      snapshotBucketName: 'teampasx-canvas-snapshots',
    });

    const snapshotEnvelope = {
      id: 'evt-snapshot',
      correlationId: 'corr-snap',
      type: 'discord.command',
      source: 'discord',
      timestamp: Date.now(),
      data: {
        userId: 'snapshot-admin',
        commandName: 'snapshot',
        applicationId: 'app-snap',
        interactionToken: 'tok-snap',
      },
    };

    const { req, res } = createMockHttp(makePubSubPayload(snapshotEnvelope));
    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getResponseData().status, 'snapshot_success');
    assert.ok(res.getResponseData().signedUrl.includes('storage.googleapis.com'));
    assert.ok(responseText.includes('Lien d\'accès signé'));
  });

  await t.test('inherits and propagates distributed W3C traceparent and links to Cloud Trace (Issue #88)', async () => {
    const originalConsoleLog = console.log;
    let capturedLog: any = null;
    console.log = (line: string) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.includes('Processing event')) {
          capturedLog = parsed;
        }
      } catch {
        // Ignore non-json
      }
    };

    try {
      const handler = createDrawWorkerHandler();
      const parentTraceParent = '00-abcdef1234567890abcdef1234567890-1122334455667788-01';

      const drawEnvelope = {
        id: 'evt-trace-test',
        correlationId: 'corr-trace-88',
        type: 'pixel.draw',
        source: 'web',
        timestamp: Date.now(),
        traceParent: parentTraceParent,
        data: {
          userId: 'user-trace',
          pixels: [{ x: 5, y: 5, color: '#ff0000' }],
        },
      };

      const { req, res } = createMockHttp(makePubSubPayload(drawEnvelope));
      await handler(req, res);

      assert.equal(res.getStatusCode(), 200);
      assert.ok(capturedLog);
      assert.equal(capturedLog.correlationId, 'corr-trace-88');
      assert.equal(capturedLog.trace_id, 'abcdef1234567890abcdef1234567890');
      assert.equal(capturedLog.parent_span_id, '1122334455667788');
      assert.ok(capturedLog['logging.googleapis.com/trace'].includes('abcdef1234567890abcdef1234567890'));
      assert.equal(capturedLog['logging.googleapis.com/trace_sampled'], true);
    } finally {
      console.log = originalConsoleLog;
    }
  });
});
