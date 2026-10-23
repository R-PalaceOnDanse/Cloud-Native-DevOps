import { newEventId } from "./ids.js";
import type { EventEnvelope, EventType, PayloadByType } from "./types.js";

export interface CreateEventInput<T extends EventType> {
  readonly eventType: T;
  readonly correlationId: string;
  readonly payload: PayloadByType[T];
  /** Injected so tests are deterministic. */
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export function createEvent<T extends EventType>(input: CreateEventInput<T>): EventEnvelope<T> {
  const now = input.now ?? (() => new Date());
  const newId = input.newId ?? newEventId;
  return {
    eventId: newId(),
    eventType: input.eventType,
    correlationId: input.correlationId,
    occurredAt: now().toISOString(),
    payload: input.payload,
  };
}
