import type {
  DiscordCommandPayload,
  EventType,
  InteractionReply,
  PayloadByType,
  PixelChange,
  PixelDrawPayload,
  SnapshotRequestedPayload,
} from "./types.js";

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

type UnknownRecord = Readonly<Record<string, unknown>>;

function fail(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: UnknownRecord, key: string): Validated<string> {
  const value = record[key];
  return typeof value === "string" && value.length > 0
    ? { ok: true, value }
    : fail(`${key} must be a non-empty string`);
}

function readOptionalString(record: UnknownRecord, key: string): Validated<string | undefined> {
  const value = record[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  return typeof value === "string" ? { ok: true, value } : fail(`${key} must be a string`);
}

function readReply(record: UnknownRecord, key: string): Validated<InteractionReply> {
  const value = record[key];
  if (!isRecord(value)) {
    return fail(`${key} must be an object`);
  }
  const applicationId = readString(value, "applicationId");
  if (!applicationId.ok) {
    return fail(`${key}.${applicationId.reason}`);
  }
  const interactionToken = readString(value, "interactionToken");
  if (!interactionToken.ok) {
    return fail(`${key}.${interactionToken.reason}`);
  }
  return {
    ok: true,
    value: { applicationId: applicationId.value, interactionToken: interactionToken.value },
  };
}

function readStringArray(record: UnknownRecord, key: string): Validated<readonly string[]> {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    return fail(`${key} must be an array of strings`);
  }
  return { ok: true, value };
}

function readPixel(value: unknown): Validated<PixelChange> {
  if (!isRecord(value)) {
    return fail("a pixel must be an object");
  }
  const { x, y } = value;
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return fail("a pixel needs integer x and y");
  }
  const color = readString(value, "color");
  if (!color.ok) {
    return fail(`a pixel's ${color.reason}`);
  }
  return { ok: true, value: { x: x as number, y: y as number, color: color.value } };
}

function validatePixelDraw(payload: unknown): Validated<PixelDrawPayload> {
  if (!isRecord(payload)) {
    return fail("payload must be an object");
  }
  const source = payload["source"];
  if (source !== "discord" && source !== "web") {
    return fail("source must be discord or web");
  }
  const userId = readString(payload, "userId");
  if (!userId.ok) {
    return userId;
  }
  const rawPixels = payload["pixels"];
  if (!Array.isArray(rawPixels) || rawPixels.length === 0) {
    return fail("pixels must be a non-empty array");
  }
  const pixels: PixelChange[] = [];
  for (const raw of rawPixels as readonly unknown[]) {
    const pixel = readPixel(raw);
    if (!pixel.ok) {
      return pixel;
    }
    pixels.push(pixel.value);
  }
  if (payload["reply"] === undefined) {
    return { ok: true, value: { source, userId: userId.value, pixels } };
  }
  const reply = readReply(payload, "reply");
  if (!reply.ok) {
    return reply;
  }
  return { ok: true, value: { source, userId: userId.value, pixels, reply: reply.value } };
}

function readOptions(record: UnknownRecord): Validated<DiscordCommandPayload["options"]> {
  const value = record["options"];
  if (!isRecord(value)) {
    return fail("options must be an object");
  }
  const options: Record<string, string | number | boolean> = {};
  for (const [key, option] of Object.entries(value)) {
    if (typeof option !== "string" && typeof option !== "number" && typeof option !== "boolean") {
      return fail(`option ${key} must be a string, number or boolean`);
    }
    options[key] = option;
  }
  return { ok: true, value: options };
}

function validateDiscordCommand(payload: unknown): Validated<DiscordCommandPayload> {
  if (!isRecord(payload)) {
    return fail("payload must be an object");
  }
  const commandName = readString(payload, "commandName");
  if (!commandName.ok) {
    return commandName;
  }
  const userId = readString(payload, "userId");
  if (!userId.ok) {
    return userId;
  }
  const subcommand = readOptionalString(payload, "subcommand");
  if (!subcommand.ok) {
    return subcommand;
  }
  const guildId = readOptionalString(payload, "guildId");
  if (!guildId.ok) {
    return guildId;
  }
  const channelId = readOptionalString(payload, "channelId");
  if (!channelId.ok) {
    return channelId;
  }
  const roleIds = readStringArray(payload, "roleIds");
  if (!roleIds.ok) {
    return roleIds;
  }
  const options = readOptions(payload);
  if (!options.ok) {
    return options;
  }
  const reply = readReply(payload, "reply");
  if (!reply.ok) {
    return reply;
  }
  return {
    ok: true,
    value: {
      commandName: commandName.value,
      ...(subcommand.value === undefined ? {} : { subcommand: subcommand.value }),
      options: options.value,
      userId: userId.value,
      roleIds: roleIds.value,
      ...(guildId.value === undefined ? {} : { guildId: guildId.value }),
      ...(channelId.value === undefined ? {} : { channelId: channelId.value }),
      reply: reply.value,
    },
  };
}

function validateSnapshotRequested(payload: unknown): Validated<SnapshotRequestedPayload> {
  if (!isRecord(payload)) {
    return fail("payload must be an object");
  }
  const requestedBy = readString(payload, "requestedBy");
  if (!requestedBy.ok) {
    return requestedBy;
  }
  const channelId = readString(payload, "channelId");
  if (!channelId.ok) {
    return channelId;
  }
  const reply = readReply(payload, "reply");
  if (!reply.ok) {
    return reply;
  }
  return {
    ok: true,
    value: { requestedBy: requestedBy.value, channelId: channelId.value, reply: reply.value },
  };
}

export function validatePayload<T extends EventType>(
  eventType: T,
  payload: unknown,
): Validated<PayloadByType[T]> {
  switch (eventType) {
    case "pixel.draw":
      return validatePixelDraw(payload) as Validated<PayloadByType[T]>;
    case "discord.command":
      return validateDiscordCommand(payload) as Validated<PayloadByType[T]>;
    case "snapshot.requested":
      return validateSnapshotRequested(payload) as Validated<PayloadByType[T]>;
    default:
      return fail("unknown event type");
  }
}
