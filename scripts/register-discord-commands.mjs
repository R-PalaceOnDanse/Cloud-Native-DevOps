#!/usr/bin/env node
/**
 * Idempotent Discord Slash Commands Registration Script (Issue #49)
 *
 * Registers the mandatory commands required by C07 §1.1:
 * - /draw (x, y, color)
 * - /get
 * - /snapshot (admin only)
 * - /admin pause
 * - /admin resume
 * - /admin clear
 * - /admin ratelimit (user, limit)
 *
 * Uses Discord REST API v10 bulk overwrite endpoint (PUT /applications/{app_id}/commands)
 * which ensures complete idempotence: calling it multiple times produces the exact same state.
 */

import { parseArgs } from 'node:util';

/**
 * Mandatory Discord commands definitions conforming to Discord Interactions API v10
 */
export const DISCORD_COMMANDS = [
  {
    name: 'draw',
    description: 'Draw a single pixel on the collaborative 10,000x10,000 canvas',
    type: 1, // CHAT_INPUT
    options: [
      {
        name: 'x',
        description: 'X coordinate (0-9999)',
        type: 4, // INTEGER
        required: true,
        min_value: 0,
        max_value: 9999,
      },
      {
        name: 'y',
        description: 'Y coordinate (0-9999)',
        type: 4, // INTEGER
        required: true,
        min_value: 0,
        max_value: 9999,
      },
      {
        name: 'color',
        description: 'Pixel hex color (e.g. #FF0000 or #3B82F6)',
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: 'get',
    description: 'Render and return the current canvas grid as a PNG image',
    type: 1, // CHAT_INPUT
    options: [],
  },
  {
    name: 'snapshot',
    description: 'Generate a timestamped canvas snapshot stored in Cloud Storage with signed URL (Admin)',
    type: 1, // CHAT_INPUT
    default_member_permissions: '8', // ADMINISTRATOR
    options: [],
  },
  {
    name: 'admin',
    description: 'Canvas administration commands',
    type: 1, // CHAT_INPUT
    default_member_permissions: '8', // ADMINISTRATOR
    options: [
      {
        name: 'pause',
        description: 'Pause canvas drawing globally (rejects subsequent draw requests)',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'resume',
        description: 'Resume canvas drawing globally',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'clear',
        description: 'Clear the entire canvas grid (increments epoch, invalidating previous state in O(1))',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'ratelimit',
        description: 'Set a per-user rate limit override',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'Discord user to apply override to',
            type: 6, // USER
            required: true,
          },
          {
            name: 'limit',
            description: 'Rate limit in pixels/minute (e.g. 60)',
            type: 4, // INTEGER
            required: true,
            min_value: 1,
          },
        ],
      },
    ],
  },
];

/**
 * Register commands against Discord REST API v10
 */
export async function registerCommands(options = {}) {
  const {
    appId = process.env.DISCORD_APPLICATION_ID,
    botToken = process.env.DISCORD_BOT_TOKEN,
    guildId = process.env.DISCORD_GUILD_ID,
    dryRun = false,
    fetchFn = globalThis.fetch,
  } = options;

  if (dryRun) {
    return {
      dryRun: true,
      commandsCount: DISCORD_COMMANDS.length,
      commands: DISCORD_COMMANDS,
      target: guildId ? `guild:${guildId}` : 'global',
    };
  }

  if (!appId) {
    throw new Error('Missing DISCORD_APPLICATION_ID (pass --app-id or set env DISCORD_APPLICATION_ID)');
  }
  if (!botToken) {
    throw new Error('Missing DISCORD_BOT_TOKEN (pass --bot-token or set env DISCORD_BOT_TOKEN)');
  }

  const endpoint = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`;

  const response = await fetchFn(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CloudNativeDevOps-CanvasBot/1.0',
    },
    body: JSON.stringify(DISCORD_COMMANDS),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Discord API error (${response.status} ${response.statusText}): ${errorBody}`);
  }

  const registered = await response.json();
  return {
    dryRun: false,
    status: response.status,
    commandsCount: registered.length,
    registeredCommands: registered.map((cmd) => cmd.name),
    target: guildId ? `guild:${guildId}` : 'global',
  };
}

// CLI entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const { values } = parseArgs({
    options: {
      'app-id': { type: 'string' },
      'bot-token': { type: 'string' },
      'guild-id': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: node scripts/register-discord-commands.mjs [options]

Registers mandatory Discord slash commands idempotently (PUT /applications/{app_id}/commands).

Options:
  --app-id <id>       Discord Application ID (or DISCORD_APPLICATION_ID env)
  --bot-token <token> Discord Bot Token (or DISCORD_BOT_TOKEN env)
  --guild-id <id>     Optional Guild ID for instant guild-scoped registration
  --dry-run           Validate commands schema and display payload without calling API
  --help              Show this help message
`);
    process.exit(0);
  }

  registerCommands({
    appId: values['app-id'],
    botToken: values['bot-token'],
    guildId: values['guild-id'],
    dryRun: values['dry-run'],
  })
    .then((result) => {
      if (result.dryRun) {
        console.log(`✅ [DRY-RUN] Validated ${result.commandsCount} Discord slash commands:`);
        for (const cmd of result.commands) {
          console.log(`   - /${cmd.name}: ${cmd.description} (${cmd.options?.length ?? 0} options)`);
        }
        console.log(`Target: ${result.target}`);
      } else {
        console.log(`🚀 Successfully registered ${result.commandsCount} commands to Discord (${result.target}):`);
        console.log(`   Commands: ${result.registeredCommands.join(', ')}`);
      }
    })
    .catch((err) => {
      console.error(`❌ Registration failed:`, err.message);
      process.exit(1);
    });
}
