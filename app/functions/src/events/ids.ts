import { randomUUID } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function newEventId(): string {
  return randomUUID();
}

export function isEventId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function isCorrelationId(value: string): boolean {
  return CORRELATION_ID_PATTERN.test(value);
}

/**
 * Keeps a correlation ID supplied by the caller when it has a safe shape, so a request can be
 * followed from its origin; otherwise creates one. The value ends up in logs, so it is restricted.
 */
export function resolveCorrelationId(supplied: string | undefined): string {
  return supplied !== undefined && isCorrelationId(supplied) ? supplied : newCorrelationId();
}
