import type { Validated } from "../events/index.js";
import { COMMANDS, type CommandDefinition } from "./commands.js";

const API_BASE = "https://discord.com/api/v10";

export interface RegistrationTarget {
  readonly applicationId: string;
  /** Bot token, read from Secret Manager by the caller. Never logged. */
  readonly botToken: string;
  /**
   * A server ID registers the commands for that server only, which takes effect at once and suits
   * development. Without it they are global.
   */
  readonly guildId?: string;
}

export interface RegistrationDeps {
  readonly fetch: typeof fetch;
  readonly commands?: readonly CommandDefinition[];
}

/**
 * Registers the commands with Discord's bulk overwrite: the list sent replaces the registered one,
 * so running it twice changes nothing, and a command removed from the code disappears from Discord.
 */
export async function registerCommands(
  target: RegistrationTarget,
  deps: RegistrationDeps,
): Promise<Validated<number>> {
  const commands = deps.commands ?? COMMANDS;
  const path =
    target.guildId === undefined
      ? `/applications/${target.applicationId}/commands`
      : `/applications/${target.applicationId}/guilds/${target.guildId}/commands`;
  let response: Response;
  try {
    response = await deps.fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { Authorization: `Bot ${target.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
  } catch {
    return { ok: false, reason: "could not reach Discord" };
  }
  if (!response.ok) {
    return { ok: false, reason: `Discord answered ${String(response.status)}` };
  }
  return { ok: true, value: commands.length };
}
