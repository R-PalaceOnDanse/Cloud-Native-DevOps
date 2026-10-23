import { createEvent } from "./create.js";
import type { DiscordCommandPayload, EventEnvelope, PixelDrawPayload, SnapshotRequestedPayload } from "./types.js";

export const FIXED_NOW = new Date("2026-10-23T12:00:00.000Z");
export const FIXED_EVENT_ID = "0b0f7a5e-2a54-4c0e-9d51-6f3b6a3a1c11";
export const FIXED_CORRELATION_ID = "6f2c7d1e-8d6b-4f7a-b1b5-1f0c2a9e4d33";

const reply = { applicationId: "1563124060290949170", interactionToken: "token-placeholder" };

export const pixelDrawPayload: PixelDrawPayload = {
  source: "discord",
  userId: "u-1",
  pixels: [{ x: 10, y: 20, color: "#ff0000" }],
  reply,
};

export const discordCommandPayload: DiscordCommandPayload = {
  commandName: "admin",
  subcommand: "ratelimit",
  options: { user: "u-2", limit: 5 },
  userId: "u-1",
  roleIds: ["r-1"],
  guildId: "g-1",
  channelId: "c-1",
  reply,
};

export const snapshotRequestedPayload: SnapshotRequestedPayload = {
  requestedBy: "u-1",
  channelId: "c-1",
  reply,
};

function fixed<T extends "pixel.draw" | "discord.command" | "snapshot.requested">(
  eventType: T,
  payload: EventEnvelope<T>["payload"],
): EventEnvelope<T> {
  return createEvent({
    eventType,
    correlationId: FIXED_CORRELATION_ID,
    payload,
    now: () => FIXED_NOW,
    newId: () => FIXED_EVENT_ID,
  });
}

export const pixelDrawEvent = fixed("pixel.draw", pixelDrawPayload);
export const discordCommandEvent = fixed("discord.command", discordCommandPayload);
export const snapshotRequestedEvent = fixed("snapshot.requested", snapshotRequestedPayload);
