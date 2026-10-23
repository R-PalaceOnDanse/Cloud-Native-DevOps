import type { Validated } from "../events/index.js";

/** Pixels a user may draw per minute unless an admin sets another limit (subject §3.3). */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 20;

export const WINDOW_MS = 60_000;

/** What is stored per user: how many pixels were used in the window that started at `windowStart`. */
export interface RateLimitState {
  /** Start of the window, in milliseconds since the epoch, aligned to a whole minute. */
  readonly windowStart: number;
  readonly used: number;
}

export interface RateLimitInput {
  /** The current time, in milliseconds since the epoch. */
  readonly now: number;
  /** Pixels the user wants to draw now: 1 for /draw, the size of the stroke for the brush. */
  readonly requested: number;
  readonly limit: number;
  /** The stored state of the user, if any. */
  readonly state: RateLimitState | undefined;
}

export type RateLimitDecision =
  | { readonly allowed: true; readonly state: RateLimitState; readonly remaining: number }
  | {
      readonly allowed: false;
      /** `limit_reached`: wait for the next window. `larger_than_limit`: can never fit, even alone. */
      readonly reason: "limit_reached" | "larger_than_limit";
      readonly state: RateLimitState;
      readonly remaining: number;
      readonly retryAfterSeconds: number;
    };

function windowStartOf(now: number): number {
  return Math.floor(now / WINDOW_MS) * WINDOW_MS;
}

/**
 * Decides whether a user may draw `requested` pixels, with fixed one-minute windows. A request is
 * accepted whole or refused whole: a stroke is never cut in the middle. The caller stores the
 * returned state, inside the same transaction that read it, so that two draws cannot both use the
 * last pixel. A fixed window lets a user use the limit twice around a minute boundary; this is
 * accepted to keep the stored state to two numbers.
 */
export function evaluateRateLimit(input: RateLimitInput): RateLimitDecision {
  const windowStart = windowStartOf(input.now);
  const used = input.state?.windowStart === windowStart ? input.state.used : 0;
  const current: RateLimitState = { windowStart, used };

  if (input.requested > input.limit) {
    return {
      allowed: false,
      reason: "larger_than_limit",
      state: current,
      remaining: Math.max(0, input.limit - used),
      retryAfterSeconds: 0,
    };
  }
  if (used + input.requested > input.limit) {
    return {
      allowed: false,
      reason: "limit_reached",
      state: current,
      remaining: input.limit - used,
      retryAfterSeconds: Math.ceil((windowStart + WINDOW_MS - input.now) / 1000),
    };
  }
  const next = { windowStart, used: used + input.requested };
  return { allowed: true, state: next, remaining: input.limit - next.used };
}

/** A limit set by an admin: a whole number of pixels per minute, 0 meaning "may not draw". */
export function parseLimit(value: unknown): Validated<number> {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? { ok: true, value }
    : { ok: false, reason: "a limit is a whole number of pixels per minute, 0 or more" };
}

/** The limit that applies to a user: the admin override if there is one, else the default. */
export function resolveLimit(override: number | undefined): number {
  return override ?? DEFAULT_RATE_LIMIT_PER_MINUTE;
}
