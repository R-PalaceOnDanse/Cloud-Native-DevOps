/**
 * Standard Event Envelope and Event Definitions.
 * Fulfills Issue #43, Issue #76, and ADR-0006.
 */

import { randomUUID } from 'node:crypto';

export type EventType = 'pixel.draw' | 'discord.command' | 'snapshot.requested';
export type EventSource = 'web' | 'discord';

export interface DrawnPixelData {
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

export interface PixelDrawData {
  readonly userId: string;
  readonly pixels: readonly DrawnPixelData[];
  readonly author?: string;
  readonly applicationId?: string;
  readonly interactionToken?: string;
  readonly roleIds?: readonly string[];
}

export interface DiscordCommandData {
  readonly interactionId: string;
  readonly commandName: string;
  readonly userId: string;
  readonly options: Record<string, unknown>;
  readonly applicationId?: string;
  readonly interactionToken?: string;
  readonly roleIds?: readonly string[];
}

export interface SnapshotRequestedData {
  readonly requestedBy: string;
  readonly timestamp: number;
}

export type EventDataMap = {
  'pixel.draw': PixelDrawData;
  'discord.command': DiscordCommandData;
  'snapshot.requested': SnapshotRequestedData;
};

/**
 * Standard Event Envelope for Pub/Sub messaging.
 */
export interface EventEnvelope<T = unknown> {
  /** Unique event identifier for idempotence */
  readonly id: string;
  /** Correlation ID carried through the entire processing pipeline */
  readonly correlationId: string;
  /** Event classification */
  readonly type: EventType;
  /** Origin of the event */
  readonly source: EventSource;
  /** Millisecond timestamp when the event was produced */
  readonly timestamp: number;
  /** Event payload */
  readonly data: T;
}

/**
 * Creates an event envelope with generated UUIDs and current timestamp.
 */
export function createEventEnvelope<K extends EventType>(
  type: K,
  source: EventSource,
  data: EventDataMap[K],
  correlationId?: string
): EventEnvelope<EventDataMap[K]> {
  return {
    id: randomUUID(),
    correlationId: correlationId || randomUUID(),
    type,
    source,
    timestamp: Date.now(),
    data,
  };
}
