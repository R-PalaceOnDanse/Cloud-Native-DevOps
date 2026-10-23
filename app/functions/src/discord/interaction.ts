import type { Validated } from "../events/index.js";

const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const OPTION_TYPE_SUB_COMMAND = 1;

type UnknownRecord = Readonly<Record<string, unknown>>;

/** What the rest of the system needs to know about a slash command interaction. */
export interface CommandInteraction {
  readonly applicationId: string;
  /** Secret, valid for 15 minutes. Never log it. */
  readonly interactionToken: string;
  readonly userId: string;
  readonly roleIds: readonly string[];
  readonly guildId?: string;
  readonly channelId?: string;
  readonly commandName: string;
  readonly subcommand?: string;
  readonly options: Readonly<Record<string, string | number | boolean>>;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Discord sends the user under `member.user` in a server and under `user` in a direct message. */
function readUser(payload: UnknownRecord): { id: string; roleIds: readonly string[] } | undefined {
  const member = payload["member"];
  if (isRecord(member)) {
    const user = member["user"];
    const id = isRecord(user) ? text(user, "id") : undefined;
    const roles = member["roles"];
    const roleIds = Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string") : [];
    return id === undefined ? undefined : { id, roleIds };
  }
  const user = payload["user"];
  const id = isRecord(user) ? text(user, "id") : undefined;
  return id === undefined ? undefined : { id, roleIds: [] };
}

function readOptions(raw: unknown): Validated<Record<string, string | number | boolean>> {
  const options: Record<string, string | number | boolean> = {};
  for (const option of Array.isArray(raw) ? (raw as readonly unknown[]) : []) {
    if (!isRecord(option)) {
      return { ok: false, reason: "an option must be an object" };
    }
    const name = text(option, "name");
    const value = option["value"];
    if (name === undefined || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) {
      return { ok: false, reason: "an option needs a name and a scalar value" };
    }
    options[name] = value;
  }
  return { ok: true, value: options };
}

/**
 * Reads a signed slash command interaction. Anything that is not a slash command, or that lacks
 * what a worker needs to act and to answer, is refused with a reason.
 */
export function parseCommandInteraction(payload: UnknownRecord): Validated<CommandInteraction> {
  if (payload["type"] !== INTERACTION_TYPE_APPLICATION_COMMAND) {
    return { ok: false, reason: "only slash commands are handled" };
  }
  const applicationId = text(payload, "application_id");
  const interactionToken = text(payload, "token");
  const user = readUser(payload);
  const data = payload["data"];
  const commandName = isRecord(data) ? text(data, "name") : undefined;
  if (applicationId === undefined || interactionToken === undefined || user === undefined || !isRecord(data) || commandName === undefined) {
    return { ok: false, reason: "the interaction lacks application_id, token, user or command name" };
  }

  const rawOptions: readonly unknown[] = Array.isArray(data["options"]) ? (data["options"] as readonly unknown[]) : [];
  const first = rawOptions[0];
  const isSubCommand = isRecord(first) && first["type"] === OPTION_TYPE_SUB_COMMAND;
  const subcommand = isSubCommand ? text(first, "name") : undefined;
  if (isSubCommand && subcommand === undefined) {
    return { ok: false, reason: "a subcommand needs a name" };
  }
  const options = readOptions(isSubCommand ? first["options"] : rawOptions);
  if (!options.ok) {
    return options;
  }
  const guildId = text(payload, "guild_id");
  const channelId = text(payload, "channel_id");
  return {
    ok: true,
    value: {
      applicationId,
      interactionToken,
      userId: user.id,
      roleIds: user.roleIds,
      ...(guildId === undefined ? {} : { guildId }),
      ...(channelId === undefined ? {} : { channelId }),
      commandName,
      ...(subcommand === undefined ? {} : { subcommand }),
      options: options.value,
    },
  };
}
