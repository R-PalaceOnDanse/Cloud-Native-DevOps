export const EVENT_TYPES = ["pixel.draw", "discord.command", "snapshot.requested"] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Version of the envelope and payload shapes, carried in the message attributes. */
export const SCHEMA_VERSION = "1";

/** What a worker needs to answer the user of a Discord interaction. */
export interface InteractionReply {
  readonly applicationId: string;
  /** Secret, valid for 15 minutes. Never log it. */
  readonly interactionToken: string;
}

export interface PixelChange {
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

export interface PixelDrawPayload {
  readonly source: "discord" | "web";
  readonly userId: string;
  readonly pixels: readonly PixelChange[];
  /** Present when the draw comes from a Discord command, so the worker can answer. */
  readonly reply?: InteractionReply;
}

export interface DiscordCommandPayload {
  readonly commandName: string;
  readonly subcommand?: string;
  readonly options: Readonly<Record<string, string | number | boolean>>;
  readonly userId: string;
  readonly roleIds: readonly string[];
  readonly guildId?: string;
  readonly channelId?: string;
  readonly reply: InteractionReply;
}

export interface SnapshotRequestedPayload {
  readonly requestedBy: string;
  readonly channelId: string;
  readonly reply: InteractionReply;
}

export interface PayloadByType {
  readonly "pixel.draw": PixelDrawPayload;
  readonly "discord.command": DiscordCommandPayload;
  readonly "snapshot.requested": SnapshotRequestedPayload;
}

export interface EventEnvelope<T extends EventType = EventType> {
  /** Unique per event; consumers use it to ignore a message delivered twice. */
  readonly eventId: string;
  readonly eventType: T;
  /** Created by the proxy and copied unchanged by every later hop. */
  readonly correlationId: string;
  /** ISO 8601 instant at which the event was created. */
  readonly occurredAt: string;
  readonly payload: PayloadByType[T];
}

/** The envelope of any event type, discriminated by `eventType`. */
export type AnyEventEnvelope = { [T in EventType]: EventEnvelope<T> }[EventType];
