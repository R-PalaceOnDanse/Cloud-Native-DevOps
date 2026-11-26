import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawWorkerHandler, type WorkerDependencies } from './index.js';
import { ChunkStore } from './chunk-store.js';
import { WorkerRateLimiter } from './rate-limiter.js';
import type { DiscordApiClient } from './discord-api.js';
import { renderCanvas, type SnapshotMetadata } from './snapshot-service.js';

function http(body: unknown) {
  let statusCode = 200;
  let data: any = null;
  const req = { method: 'POST', body, headers: {} } as any;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      data = payload;
      return this;
    },
  } as any;
  return { req, res, status: () => statusCode, data: () => data };
}

function push(envelope: unknown) {
  return { message: { data: Buffer.from(JSON.stringify(envelope)).toString('base64'), messageId: 'm-1' } };
}

function setup(overrides: Partial<WorkerDependencies> = {}, admins: string[] = []) {
  const replies: string[] = [];
  const images: Buffer[] = [];
  const saved: Array<{ name: string; metadata: SnapshotMetadata }> = [];
  const deps: WorkerDependencies = {
    canvas: new ChunkStore(admins),
    rateLimiter: new WorkerRateLimiter(),
    snapshots: {
      save: async (name: string, _png: Buffer, metadata: SnapshotMetadata) => {
        saved.push({ name, metadata });
      },
    },
    discord: {
      editOriginalResponse: async (_a: string, _t: string, p: { content?: string }) => {
        replies.push(p.content ?? '');
        return true;
      },
      postFollowupWithImage: async (_a: string, _t: string, png: Buffer) => {
        images.push(png);
        return true;
      },
    } as unknown as DiscordApiClient,
    ...overrides,
  };
  return { deps, handler: createDrawWorkerHandler(() => deps), replies, images, saved };
}

const draw = (id: string, userId: string, pixels: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  correlationId: `corr-${id}`,
  type: 'pixel.draw',
  source: 'web',
  timestamp: Date.now(),
  data: { userId, pixels, applicationId: 'app', interactionToken: 'tok', ...extra },
});

const command = (id: string, userId: string, commandName: string, options: Record<string, unknown> = {}) => ({
  id,
  correlationId: `corr-${id}`,
  type: 'discord.command',
  source: 'discord',
  timestamp: Date.now(),
  data: { userId, commandName, options, applicationId: 'app', interactionToken: 'tok' },
});

test('draw worker', async (t) => {
  await t.test('answers 400 when the Pub/Sub message has no data or is not JSON', async () => {
    const { handler } = setup();
    const a = http({});
    await handler(a.req, a.res);
    assert.equal(a.status(), 400);
    const b = http({ message: { data: Buffer.from('not-json').toString('base64') } });
    await handler(b.req, b.res);
    assert.equal(b.status(), 400);
  });

  await t.test('writes the pixels with author and timestamp, and edits the Discord answer', async () => {
    const { deps, handler, replies } = setup();
    const h = http(push(draw('e1', 'alice', [{ x: 10, y: 20, color: '#FF0000' }, { x: 11, y: 20, color: '#00ff00' }], { author: 'Alice' })));
    await handler(h.req, h.res);
    assert.equal(h.status(), 200);
    assert.equal(h.data().status, 'processed');
    assert.equal(h.data().applied, 2);
    const store = deps.canvas as ChunkStore;
    assert.equal(store.getPixel(10, 20)?.color, '#ff0000');
    assert.equal(store.getPixel(10, 20)?.author, 'Alice');
    assert.ok(store.getPixel(11, 20)?.timestamp);
    assert.match(replies[0]!, /drawn/);
  });

  await t.test('is idempotent when Pub/Sub redelivers the same event', async () => {
    const { handler } = setup();
    const event = draw('dup', 'bob', [{ x: 1, y: 1, color: '#000000' }]);
    await handler(http(push(event)).req, http(push(event)).res);
    const again = http(push(event));
    await handler(again.req, again.res);
    assert.equal(again.data().applied, 0);
    assert.equal(again.data().duplicate, true);
  });

  await t.test('rejects draws while paused, from the web as from Discord', async () => {
    const { deps, handler } = setup();
    (deps.canvas as ChunkStore).setPauseState(true);
    const h = http(push(draw('p', 'bob', [{ x: 50, y: 50, color: '#ff0000' }])));
    await handler(h.req, h.res);
    assert.equal(h.data().status, 'rejected_paused');
    assert.equal((deps.canvas as ChunkStore).getPixel(50, 50), undefined);
  });

  await t.test('applies the default limit of 20 pixels per minute', async () => {
    const { deps, handler } = setup();
    await deps.rateLimiter.tryConsume('charlie', 20);
    const h = http(push(draw('rl', 'charlie', [{ x: 100, y: 100, color: '#ff0000' }])));
    await handler(h.req, h.res);
    assert.equal(h.data().status, 'rate_limited');
  });

  await t.test('rejects pixels out of the 10000x10000 grid or with a bad color', async () => {
    const { handler } = setup();
    const out = http(push(draw('oob', 'dan', [{ x: 10000, y: 5, color: '#ff0000' }])));
    await handler(out.req, out.res);
    assert.equal(out.data().status, 'invalid_coordinates');
    const color = http(push(draw('col', 'dan', [{ x: 1, y: 5, color: 'red' }])));
    await handler(color.req, color.res);
    assert.equal(color.data().status, 'invalid_coordinates');
  });

  await t.test('refuses admin commands to a normal user and accepts them from an admin', async () => {
    const { deps, handler } = setup({}, ['eve']);
    const refused = http(push(command('a1', 'mallory', 'admin', { subcommand: 'pause' })));
    await handler(refused.req, refused.res);
    assert.equal(refused.data().status, 'unauthorized');
    assert.equal((deps.canvas as ChunkStore).getPauseState(), false);

    const accepted = http(push(command('a2', 'eve', 'admin', { subcommand: 'pause' })));
    await handler(accepted.req, accepted.res);
    assert.equal(accepted.data().status, 'admin_pause_success');
    assert.equal((deps.canvas as ChunkStore).getPauseState(), true);

    const resumed = http(push(command('a3', 'eve', 'admin', { subcommand: 'resume' })));
    await handler(resumed.req, resumed.res);
    assert.equal((deps.canvas as ChunkStore).getPauseState(), false);
  });

  await t.test('admin clear empties the grid and is idempotent on Pub/Sub redelivery', async () => {
    const { deps, handler } = setup({}, ['eve']);
    await deps.canvas.applyDraw('before', [{ x: 5, y: 5, color: '#ff0000' }], 'u', Date.now());
    const h = http(push(command('c', 'eve', 'admin', { subcommand: 'clear' })));
    await handler(h.req, h.res);
    assert.equal(h.data().status, 'admin_clear_success');
    assert.equal(h.data().duplicate, false);
    const epochAfterFirst = h.data().epoch;
    assert.equal((deps.canvas as ChunkStore).getPixel(5, 5), undefined);

    // Draw a new pixel after the clear, then simulate Pub/Sub redelivering the same clear event
    await deps.canvas.applyDraw('after', [{ x: 6, y: 6, color: '#00ff00' }], 'u', Date.now());
    const dup = http(push(command('c', 'eve', 'admin', { subcommand: 'clear' })));
    await handler(dup.req, dup.res);
    assert.equal(dup.data().status, 'admin_clear_success');
    assert.equal(dup.data().duplicate, true);
    assert.equal(dup.data().epoch, epochAfterFirst);
    assert.ok((deps.canvas as ChunkStore).getPixel(6, 6));
  });

  await t.test('admin ratelimit overrides the limit of one user', async () => {
    const { handler } = setup({}, ['eve']);
    const set = http(push(command('r', 'eve', 'admin', { subcommand: 'ratelimit', user: 'zoe', limit: 0 })));
    await handler(set.req, set.res);
    assert.equal(set.data().status, 'admin_ratelimit_success');
    const h = http(push(draw('z', 'zoe', [{ x: 1, y: 1, color: '#ff0000' }])));
    await handler(h.req, h.res);
    assert.equal(h.data().status, 'rate_limited');
  });

  await t.test('/get posts a PNG of the canvas', async () => {
    const { deps, handler, images } = setup();
    await deps.canvas.applyDraw('g', [{ x: 500, y: 600, color: '#123456' }], 'u', Date.now());
    const h = http(push(command('get', 'viewer', 'get')));
    await handler(h.req, h.res);
    assert.equal(h.data().status, 'get_success');
    assert.deepEqual([...images[0]!.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  });

  await t.test('/snapshot stores a timestamped image with the interaction in its metadata (admins only)', async () => {
    const { handler, saved, replies } = setup({}, ['eve']);
    const refused = http(push(command('s0', 'mallory', 'snapshot')));
    await handler(refused.req, refused.res);
    assert.equal(refused.data().status, 'unauthorized');
    assert.equal(saved.length, 0);

    const traceParent = '00-abcdef1234567890abcdef1234567890-1122334455667788-01';
    const h = http(push({ ...command('s1', 'eve', 'snapshot'), traceParent }));
    await handler(h.req, h.res);
    assert.equal(h.data().status, 'snapshot_success');
    assert.equal(h.data().signedUrl, undefined); // signing is the notifier's job now
    assert.match(saved[0]!.name, /^snapshots\/\d{4}-\d{2}-\d{2}T.*\.png$/);
    const meta = saved[0]!.metadata;
    assert.equal(meta.applicationId, 'app');
    assert.equal(meta.interactionToken, 'tok');
    assert.equal(meta.correlationId, 'corr-s1');
    assert.equal(meta.requestedBy, 'eve');
    // Same trace, parent = the worker span, so the notifier span hangs under it.
    assert.equal(meta.traceparent, `00-abcdef1234567890abcdef1234567890-${h.data().spanId}-01`);
    assert.match(replies.at(-1)!, /being prepared/);
  });

  await t.test('/snapshot answers 500 when the upload fails so Pub/Sub retries', async () => {
    const { handler } = setup(
      {
        snapshots: {
          save: async () => {
            throw new Error('storage unavailable');
          },
        },
      },
      ['eve']
    );
    const h = http(push(command('s2', 'eve', 'snapshot')));
    await handler(h.req, h.res);
    assert.equal(h.status(), 500);
  });

  await t.test('answers 500 on a storage failure so Pub/Sub retries then dead-letters', async () => {
    const failing = new ChunkStore();
    failing.applyDraw = async () => {
      throw new Error('firestore unavailable');
    };
    const { handler } = setup({ canvas: failing });
    const h = http(push(draw('f', 'u', [{ x: 1, y: 1, color: '#ff0000' }])));
    await handler(h.req, h.res);
    assert.equal(h.status(), 500);
  });

  await t.test('keeps the trace of the proxy in its structured logs (Issue #88)', async () => {
    const { handler } = setup();
    const original = console.log;
    let captured: any;
    console.log = (line: string) => {
      try {
        const parsed = JSON.parse(line);
        if (String(parsed.message).startsWith('Processing event')) captured = parsed;
      } catch {
        /* not JSON */
      }
    };
    try {
      const h = http(push({ ...draw('tr', 'u', [{ x: 5, y: 5, color: '#ff0000' }]), traceParent: '00-abcdef1234567890abcdef1234567890-1122334455667788-01' }));
      await handler(h.req, h.res);
    } finally {
      console.log = original;
    }
    assert.equal(captured.correlationId, 'corr-tr');
    assert.equal(captured.trace_id, 'abcdef1234567890abcdef1234567890');
    assert.equal(captured.parent_span_id, '1122334455667788');
  });
});

test('renderCanvas crops the painted area and keeps the image small on a 10000x10000 grid', () => {
  const image = renderCanvas([
    { x: 0, y: 0, color: '#ff0000' },
    { x: 9999, y: 9999, color: '#0000ff' },
  ]);
  assert.ok(image.width <= 1024 && image.height <= 1024);
  assert.equal(image.scale, 10);
});
