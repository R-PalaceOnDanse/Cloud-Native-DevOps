/**
 * Turns a Discord slash command into the event the worker consumes (C06 §5, C07 §1).
 *
 * Same envelope as the web proxy: { id, correlationId, type, source, timestamp, traceParent, data }.
 *   /draw                       -> pixel.draw       { userId, author, pixels: [{x, y, color}], applicationId, interactionToken }
 *   /get, /snapshot, /admin ... -> discord.command  { commandName, userId, roleIds, options, applicationId, interactionToken }
 * The proxy does no business logic: authorization, rate limit and pause are decided by the worker.
 */

import { randomBytes, randomUUID } from 'node:crypto';

export const PING = 1;
export const APPLICATION_COMMAND = 2;

export interface DiscordOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordOption[];
}

export interface DiscordInteraction {
  type?: number;
  id?: string;
  application_id?: string;
  token?: string;
  guild_id?: string;
  data?: { name?: string; options?: DiscordOption[] };
  member?: { user?: { id?: string; username?: string; global_name?: string | null }; roles?: string[] };
  user?: { id?: string; username?: string; global_name?: string | null };
}

export interface EventEnvelope<T = unknown> {
  id: string;
  correlationId: string;
  type: 'pixel.draw' | 'discord.command';
  source: 'discord';
  timestamp: number;
  traceParent: string;
  data: T;
}

/** A few names accepted in /draw on top of hex values. */
const PALETTE: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ff8000', purple: '#800080', pink: '#ff69b4', gray: '#808080', grey: '#808080',
};

/** "#FF0000", "ff0000", "#f00" or a palette name -> "#ff0000"; null when it is not a color. */
export function normalizeColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase();
  if (PALETTE[raw]) return PALETTE[raw]!;
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${hex.split('').map((c) => c + c).join('')}`;
  return null;
}

/** Flattens the options: a sub-command becomes { subcommand: name, ...its options }. */
export function flattenOptions(options: DiscordOption[] = []): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const option of options) {
    if (option.type === 1 || option.type === 2) {
      out.subcommand = option.name;
      Object.assign(out, flattenOptions(option.options));
    } else if (option.value !== undefined) {
      out[option.name] = option.value;
    }
  }
  return out;
}

export type BuildResult =
  | { ok: true; envelope: EventEnvelope }
  | { ok: false; message: string };

export function buildEvent(interaction: DiscordInteraction, now = Date.now()): BuildResult {
  const user = interaction.member?.user ?? interaction.user;
  const userId = user?.id;
  const commandName = interaction.data?.name;
  if (!userId || !commandName || !interaction.application_id || !interaction.token) {
    return { ok: false, message: 'Malformed interaction.' };
  }

  const base = {
    id: interaction.id ?? randomUUID(),
    correlationId: randomUUID(),
    source: 'discord' as const,
    timestamp: now,
    traceParent: `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`,
  };
  const reply = { applicationId: interaction.application_id, interactionToken: interaction.token };
  const options = flattenOptions(interaction.data?.options);

  if (commandName === 'draw') {
    const x = Number(options.x);
    const y = Number(options.y);
    const color = normalizeColor(options.color);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 9999 || y < 0 || y > 9999) {
      return { ok: false, message: 'x and y must be whole numbers between 0 and 9999.' };
    }
    if (!color) {
      return { ok: false, message: 'The color must be a hex value like #ff0000, or one of: ' + Object.keys(PALETTE).join(', ') + '.' };
    }
    return {
      ok: true,
      envelope: {
        ...base,
        type: 'pixel.draw',
        data: { userId, author: user?.global_name || user?.username || `discord:${userId}`, pixels: [{ x, y, color }], ...reply },
      },
    };
  }

  return {
    ok: true,
    envelope: {
      ...base,
      type: 'discord.command',
      data: { commandName, userId, roleIds: interaction.member?.roles ?? [], options, ...reply },
    },
  };
}
