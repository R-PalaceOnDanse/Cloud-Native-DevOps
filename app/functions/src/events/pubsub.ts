import { isCorrelationId, isEventId } from "./ids.js";
import { validatePayload, type Validated } from "./validate.js";
import {
  EVENT_TYPES,
  SCHEMA_VERSION,
  type AnyEventEnvelope,
  type EventEnvelope,
  type EventType,
} from "./types.js";

/** A Pub/Sub message as the code sees it: JSON text of the payload plus string attributes. */
export interface PubsubMessage {
  readonly data: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * The identifying fields travel as attributes, so a subscription can filter on them and a log line
 * can be written without parsing the payload.
 */
export function toPubsubMessage(event: EventEnvelope): PubsubMessage {
  return {
    data: JSON.stringify(event.payload),
    attributes: {
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      occurredAt: event.occurredAt,
      schemaVersion: SCHEMA_VERSION,
    },
  };
}

function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

function parseJson(text: string): Validated<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "data is not valid JSON" };
  }
}

/** Turns a received message back into an envelope, rejecting anything that does not fit. */
export function parseEnvelope(message: PubsubMessage): Validated<AnyEventEnvelope> {
  const { eventId, eventType, correlationId, occurredAt, schemaVersion } = message.attributes;
  if (schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported schemaVersion ${String(schemaVersion)}` };
  }
  if (eventId === undefined || !isEventId(eventId)) {
    return { ok: false, reason: "eventId attribute is missing or not a UUID" };
  }
  if (eventType === undefined || !isEventType(eventType)) {
    return { ok: false, reason: "eventType attribute is missing or unknown" };
  }
  if (correlationId === undefined || !isCorrelationId(correlationId)) {
    return { ok: false, reason: "correlationId attribute is missing or malformed" };
  }
  if (occurredAt === undefined || Number.isNaN(Date.parse(occurredAt))) {
    return { ok: false, reason: "occurredAt attribute is missing or not a date" };
  }
  const json = parseJson(message.data);
  if (!json.ok) {
    return json;
  }
  const payload = validatePayload(eventType, json.value);
  if (!payload.ok) {
    return payload;
  }
  return {
    ok: true,
    value: { eventId, eventType, correlationId, occurredAt, payload: payload.value } as AnyEventEnvelope,
  };
}

/**
 * Reads the body that a Pub/Sub push subscription posts to a function:
 * `{ "message": { "data": "<base64>", "attributes": { ... } } }`.
 */
export function decodePushBody(body: unknown): Validated<PubsubMessage> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "body must be an object" };
  }
  const message = (body as Readonly<Record<string, unknown>>)["message"];
  if (typeof message !== "object" || message === null) {
    return { ok: false, reason: "body.message must be an object" };
  }
  const { data, attributes } = message as Readonly<Record<string, unknown>>;
  if (typeof data !== "string") {
    return { ok: false, reason: "message.data must be a base64 string" };
  }
  const decoded: Record<string, string> = {};
  if (typeof attributes === "object" && attributes !== null) {
    for (const [key, value] of Object.entries(attributes)) {
      if (typeof value === "string") {
        decoded[key] = value;
      }
    }
  }
  return { ok: true, value: { data: Buffer.from(data, "base64").toString("utf8"), attributes: decoded } };
}
