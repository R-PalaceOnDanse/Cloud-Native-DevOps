import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DISCORD_COMMANDS, registerCommands } from './register-discord-commands.mjs';

describe('Discord Commands Registration (Issue #49)', () => {
  it('defines all mandatory commands from C07 §1.1', () => {
    const names = DISCORD_COMMANDS.map((c) => c.name);
    assert.ok(names.includes('draw'), 'Must have /draw command');
    assert.ok(names.includes('get'), 'Must have /get command');
    assert.ok(names.includes('snapshot'), 'Must have /snapshot command');
    assert.ok(names.includes('admin'), 'Must have /admin command');
  });

  it('validates /draw parameters (x, y, color)', () => {
    const draw = DISCORD_COMMANDS.find((c) => c.name === 'draw');
    assert.ok(draw);
    assert.equal(draw.type, 1);
    const optNames = draw.options.map((o) => o.name);
    assert.deepEqual(optNames, ['x', 'y', 'color']);

    const optX = draw.options.find((o) => o.name === 'x');
    assert.equal(optX.type, 4); // INTEGER
    assert.equal(optX.min_value, 0);
    assert.equal(optX.max_value, 9999);
    assert.equal(optX.required, true);

    const optY = draw.options.find((o) => o.name === 'y');
    assert.equal(optY.type, 4); // INTEGER
    assert.equal(optY.min_value, 0);
    assert.equal(optY.max_value, 9999);
    assert.equal(optY.required, true);

    const optColor = draw.options.find((o) => o.name === 'color');
    assert.equal(optColor.type, 3); // STRING
    assert.equal(optColor.required, true);
  });

  it('validates /admin subcommands (pause, resume, clear, ratelimit)', () => {
    const admin = DISCORD_COMMANDS.find((c) => c.name === 'admin');
    assert.ok(admin);
    assert.equal(admin.default_member_permissions, '8'); // Administrator permission bit
    const subNames = admin.options.map((o) => o.name);
    assert.deepEqual(subNames, ['pause', 'resume', 'clear', 'ratelimit']);

    const ratelimit = admin.options.find((o) => o.name === 'ratelimit');
    assert.equal(ratelimit.type, 1); // SUB_COMMAND
    const rlOpts = ratelimit.options.map((o) => o.name);
    assert.deepEqual(rlOpts, ['user', 'limit']);
  });

  it('executes in dry-run mode without credentials', async () => {
    const result = await registerCommands({ dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.commandsCount, 4);
    assert.equal(result.target, 'global');
    assert.equal(result.commands.length, 4);
  });

  it('executes in dry-run mode with guild target', async () => {
    const result = await registerCommands({ dryRun: true, guildId: '123456789' });
    assert.equal(result.dryRun, true);
    assert.equal(result.target, 'guild:123456789');
  });

  it('throws descriptive error if credentials are missing in live mode', async () => {
    await assert.rejects(
      async () => {
        await registerCommands({ appId: '', botToken: 'some-token' });
      },
      { message: /Missing DISCORD_APPLICATION_ID/ },
    );

    await assert.rejects(
      async () => {
        await registerCommands({ appId: '12345', botToken: '' });
      },
      { message: /Missing DISCORD_BOT_TOKEN/ },
    );
  });

  it('performs idempotent PUT request to global Discord endpoint', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders = {};
    let capturedBody = '';

    const mockFetch = async (url, init) => {
      capturedUrl = url;
      capturedMethod = init.method;
      capturedHeaders = init.headers;
      capturedBody = init.body;

      return {
        ok: true,
        status: 200,
        json: async () => [
          { name: 'draw' },
          { name: 'get' },
          { name: 'snapshot' },
          { name: 'admin' },
        ],
      };
    };

    const res = await registerCommands({
      appId: '987654321',
      botToken: 'secret-token-xyz',
      fetchFn: mockFetch,
    });

    assert.equal(capturedUrl, 'https://discord.com/api/v10/applications/987654321/commands');
    assert.equal(capturedMethod, 'PUT');
    assert.equal(capturedHeaders['Authorization'], 'Bot secret-token-xyz');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');

    const parsedBody = JSON.parse(capturedBody);
    assert.equal(parsedBody.length, 4);
    assert.deepEqual(res.registeredCommands, ['draw', 'get', 'snapshot', 'admin']);
  });

  it('targets guild endpoint when guildId is provided', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => [{ name: 'draw' }],
      };
    };

    await registerCommands({
      appId: '987654321',
      botToken: 'secret-token-xyz',
      guildId: 'my-guild-123',
      fetchFn: mockFetch,
    });

    assert.equal(capturedUrl, 'https://discord.com/api/v10/applications/987654321/guilds/my-guild-123/commands');
  });

  it('handles Discord API errors with status and message', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"message": "401: Unauthorized", "code": 0}',
    });

    await assert.rejects(
      async () => {
        await registerCommands({
          appId: '987654321',
          botToken: 'invalid-token',
          fetchFn: mockFetch,
        });
      },
      { message: /Discord API error \(401 Unauthorized\)/ },
    );
  });
});
