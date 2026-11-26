import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotNotifierHandler, SIGNED_URL_SECONDS, type NotifierDependencies } from './index.js';
import { DiscordWebhookClient, type DiscordEditResult } from './discord-api.js';

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

const TRACE = 'abcdef1234567890abcdef1234567890';
const WORKER_SPAN = '1122334455667788';
const SIGNED = 'https://storage.googleapis.com/b/snapshots/x.png?X-Goog-Signature=secret';

/** What a GCS notification (JSON_API_V1) pushes: the object resource, with its custom metadata. */
function notification(metadata: Record<string, string> | undefined, eventType = 'OBJECT_FINALIZE') {
  const object = { kind: 'storage#object', bucket: 'proj-canvas-snapshots', name: 'snapshots/2026-11-26T10-00-00-000Z.png', contentType: 'image/png', ...(metadata ? { metadata } : {}) };
  return {
    message: {
      data: Buffer.from(JSON.stringify(object)).toString('base64'),
      attributes: { eventType, payloadFormat: 'JSON_API_V1', bucketId: object.bucket, objectId: object.name },
      messageId: 'm-1',
    },
  };
}

const interaction = {
  applicationId: 'app-1',
  interactionToken: 'tok-1',
  correlationId: 'corr-snap',
  traceparent: `00-${TRACE}-${WORKER_SPAN}-01`,
  requestedBy: 'eve',
};

function setup(discordResult: DiscordEditResult | Error = { ok: true, status: 200 }) {
  const signed: Array<{ bucket: string; objectName: string; expires: number }> = [];
  const edits: Array<{ appId: string; token: string; content: string }> = [];
  const deps: NotifierDependencies = {
    signer: {
      signReadUrl: async (bucket, objectName, expires) => {
        signed.push({ bucket, objectName, expires });
        return SIGNED;
      },
    },
    discord: {
      editOriginal: async (appId, token, payload) => {
        edits.push({ appId, token, content: payload.content });
        if (discordResult instanceof Error) throw discordResult;
        return discordResult;
      },
    },
  };
  return { deps, handler: createSnapshotNotifierHandler(() => deps), signed, edits };
}

/** Runs fn with console silenced, returns every JSON line logged. */
async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (line: string) => void lines.push(String(line));
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
  return lines;
}

test('snapshot notifier', async (t) => {
  await t.test('signs a 1 hour read URL and edits the original interaction answer', async () => {
    const { handler, signed, edits } = setup();
    const h = http(notification(interaction));
    const logs = await captureLogs(() => handler(h.req, h.res));

    assert.equal(h.status(), 200);
    assert.equal(h.data().status, 'notified');
    assert.deepEqual(signed, [{ bucket: 'proj-canvas-snapshots', objectName: 'snapshots/2026-11-26T10-00-00-000Z.png', expires: SIGNED_URL_SECONDS }]);
    assert.equal(SIGNED_URL_SECONDS, 3600);
    assert.equal(edits[0]!.appId, 'app-1');
    assert.equal(edits[0]!.token, 'tok-1');
    assert.ok(edits[0]!.content.includes(SIGNED));

    // One trace from /snapshot to the link: same trace ID, parent = the worker span.
    assert.equal(h.data().traceId, TRACE);
    assert.equal(h.data().parentSpanId, WORKER_SPAN);
    const done = logs.map((l) => JSON.parse(l)).find((l) => l.message.startsWith('Signed snapshot link'));
    assert.equal(done.correlationId, 'corr-snap');
    assert.equal(done['logging.googleapis.com/trace'].endsWith(`/traces/${TRACE}`), true);
    // The signed URL and the interaction token are credentials: never in the logs.
    assert.ok(!logs.some((l) => l.includes('X-Goog-Signature') || l.includes('tok-1')));
  });

  await t.test('acknowledges (200) and does nothing when the object has no interaction metadata', async () => {
    for (const metadata of [undefined, { correlationId: 'c' }]) {
      const { handler, signed, edits } = setup();
      const h = http(notification(metadata));
      await captureLogs(() => handler(h.req, h.res));
      assert.equal(h.status(), 200);
      assert.equal(h.data().status, 'ignored_no_interaction');
      assert.equal(signed.length, 0);
      assert.equal(edits.length, 0);
    }
  });

  await t.test('acknowledges other events and malformed payloads instead of retrying them', async () => {
    const { handler, edits } = setup();
    const del = http(notification(interaction, 'OBJECT_DELETE'));
    const bad = http({ message: { data: Buffer.from('not-json').toString('base64') } });
    await captureLogs(async () => {
      await handler(del.req, del.res);
      await handler(bad.req, bad.res);
    });
    assert.equal(del.status(), 200);
    assert.equal(bad.status(), 200);
    assert.equal(bad.data().status, 'ignored_malformed');
    assert.equal(edits.length, 0);
  });

  await t.test('answers 500 when Discord fails transiently, so Pub/Sub retries', async () => {
    for (const failure of [{ ok: false, status: 503 }, { ok: false, status: 429 }, new Error('ECONNRESET')]) {
      const { handler } = setup(failure);
      const h = http(notification(interaction));
      await captureLogs(() => handler(h.req, h.res));
      assert.equal(h.status(), 500);
      assert.equal(h.data().status, 'failed');
    }
  });

  await t.test('answers 500 when signing fails (IAM signBlob unavailable)', async () => {
    const { deps, handler } = setup();
    deps.signer.signReadUrl = async () => {
      throw new Error('iamcredentials unavailable');
    };
    const h = http(notification(interaction));
    await captureLogs(() => handler(h.req, h.res));
    assert.equal(h.status(), 500);
  });

  await t.test('does not retry when Discord refuses for good (expired interaction token)', async () => {
    const { handler } = setup({ ok: false, status: 404 });
    const h = http(notification(interaction));
    await captureLogs(() => handler(h.req, h.res));
    assert.equal(h.status(), 200);
    assert.equal(h.data().status, 'discord_rejected');
  });
});

test('DiscordWebhookClient PATCHes the original answer of the interaction, without a bot token', async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
  const client = new DiscordWebhookClient(async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return { ok: true, status: 200 };
  });
  const result = await client.editOriginal('app-1', 'tok-1', { content: 'hi' });
  assert.deepEqual(result, { ok: true, status: 200 });
  assert.equal(calls[0]!.url, 'https://discord.com/api/v10/webhooks/app-1/tok-1/messages/@original');
  assert.equal(calls[0]!.method, 'PATCH');
  assert.equal(calls[0]!.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0]!.body), { content: 'hi' });
});
