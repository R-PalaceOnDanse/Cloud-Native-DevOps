import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createDiscordProxyHandler } from './index';
import { normalizeColor, type EventEnvelope } from './interaction';

// A key pair playing Discord.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyHex = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('hex');

function call(body: unknown, { signed = true }: { signed?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = '1700000000';
  const signature = signed ? sign(null, Buffer.from(timestamp + raw), privateKey).toString('hex') : '00'.repeat(64);
  const headers: Record<string, string> = { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp };
  let status = 0;
  let payload: any;
  const req = { method: 'POST', body, rawBody: Buffer.from(raw), get: (h: string) => headers[h.toLowerCase()] } as any;
  const res = {
    status(code: number) { status = code; return this; },
    json(p: unknown) { payload = p; return this; },
    send(p: unknown) { payload = p; return this; },
  } as any;
  return { req, res, status: () => status, payload: () => payload };
}

function setup(publishImpl?: (e: EventEnvelope) => Promise<string>) {
  const published: EventEnvelope[] = [];
  const handler = createDiscordProxyHandler({
    readPublicKey: async () => publicKeyHex,
    publish: publishImpl ?? (async (e) => { published.push(e); return 'msg-1'; }),
  });
  return { handler, published };
}

const command = (name: string, options: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  type: 2,
  id: 'interaction-1',
  application_id: 'app-1',
  token: 'token-1',
  data: { name, options },
  member: { user: { id: '111111111111111111', username: 'alice', global_name: 'Alice' }, roles: ['role-admin'] },
  ...extra,
});

test('rejects a request whose signature is invalid, before reading it', async () => {
  const { handler, published } = setup();
  const c = call(command('get'), { signed: false });
  await handler(c.req, c.res);
  assert.equal(c.status(), 401);
  assert.equal(published.length, 0);
});

test('answers PING with PONG', async () => {
  const { handler } = setup();
  const c = call({ type: 1 });
  await handler(c.req, c.res);
  assert.deepEqual(c.payload(), { type: 1 });
});

test('/draw publishes a pixel.draw event and defers the answer', async () => {
  const { handler, published } = setup();
  const c = call(command('draw', [
    { name: 'x', type: 4, value: 10 },
    { name: 'y', type: 4, value: 20 },
    { name: 'color', type: 3, value: '#FF0000' },
  ]));
  await handler(c.req, c.res);
  assert.deepEqual(c.payload(), { type: 5 });
  assert.equal(published.length, 1);
  const e = published[0]!;
  assert.equal(e.type, 'pixel.draw');
  assert.equal(e.source, 'discord');
  assert.match(e.traceParent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.deepEqual(e.data, {
    userId: '111111111111111111',
    author: 'Alice',
    pixels: [{ x: 10, y: 20, color: '#ff0000' }],
    applicationId: 'app-1',
    interactionToken: 'token-1',
  });
});

test('/draw with a bad color or coordinate answers an ephemeral error and publishes nothing', async () => {
  const { handler, published } = setup();
  const bad = call(command('draw', [
    { name: 'x', type: 4, value: 10 },
    { name: 'y', type: 4, value: 20 },
    { name: 'color', type: 3, value: 'not-a-color' },
  ]));
  await handler(bad.req, bad.res);
  assert.equal(bad.payload().type, 4);
  assert.equal(bad.payload().data.flags, 64);
  assert.equal(published.length, 0);
});

test('/admin ratelimit is flattened into a discord.command with the sub-command and its options', async () => {
  const { handler, published } = setup();
  const c = call(command('admin', [
    { name: 'ratelimit', type: 1, options: [{ name: 'user', type: 6, value: '222' }, { name: 'limit', type: 4, value: 60 }] },
  ]));
  await handler(c.req, c.res);
  assert.deepEqual(c.payload(), { type: 5 });
  assert.equal(published[0]!.type, 'discord.command');
  assert.deepEqual(published[0]!.data, {
    commandName: 'admin',
    userId: '111111111111111111',
    roleIds: ['role-admin'],
    options: { subcommand: 'ratelimit', user: '222', limit: 60 },
    applicationId: 'app-1',
    interactionToken: 'token-1',
  });
});

test('a failed publish gives the user an ephemeral error instead of a response that never comes', async () => {
  const { handler } = setup(async () => { throw new Error('pubsub down'); });
  const c = call(command('get'));
  await handler(c.req, c.res);
  assert.equal(c.status(), 200);
  assert.equal(c.payload().type, 4);
  assert.equal(c.payload().data.flags, 64);
});

test('normalizeColor accepts hex in any case, short hex and palette names', () => {
  assert.equal(normalizeColor('#3B82F6'), '#3b82f6');
  assert.equal(normalizeColor('3b82f6'), '#3b82f6');
  assert.equal(normalizeColor('#f00'), '#ff0000');
  assert.equal(normalizeColor('Red'), '#ff0000');
  assert.equal(normalizeColor('#12345'), null);
});
