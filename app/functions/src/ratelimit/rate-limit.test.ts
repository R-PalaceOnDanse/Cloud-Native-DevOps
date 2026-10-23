import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  evaluateRateLimit,
  parseLimit,
  resolveLimit,
  WINDOW_MS,
  type RateLimitState,
} from "./rate-limit.js";

const MINUTE_START = 1_700_000_040_000; // a whole minute
const NOW = MINUTE_START + 10_000; // 10 seconds into it

function evaluate(requested: number, state: RateLimitState | undefined, limit = 20, now = NOW) {
  return evaluateRateLimit({ now, requested, limit, state });
}

describe("evaluateRateLimit", () => {
  it("accepts the first draw and counts it in a window aligned to the minute", () => {
    expect(evaluate(1, undefined)).toEqual({
      allowed: true,
      state: { windowStart: MINUTE_START, used: 1 },
      remaining: 19,
    });
  });

  it("accepts draws until the limit is exactly reached", () => {
    const decision = evaluate(5, { windowStart: MINUTE_START, used: 15 });
    expect(decision).toEqual({ allowed: true, state: { windowStart: MINUTE_START, used: 20 }, remaining: 0 });
  });

  it("refuses a draw over the limit and says when to retry", () => {
    const decision = evaluate(1, { windowStart: MINUTE_START, used: 20 });
    expect(decision).toEqual({
      allowed: false,
      reason: "limit_reached",
      state: { windowStart: MINUTE_START, used: 20 },
      remaining: 0,
      retryAfterSeconds: 50,
    });
  });

  it("refuses a stroke whole rather than cutting it", () => {
    const decision = evaluate(6, { windowStart: MINUTE_START, used: 15 });
    expect(decision).toMatchObject({ allowed: false, reason: "limit_reached", remaining: 5 });
    expect(decision.state.used).toBe(15);
  });

  it("starts a new window when the stored one is over", () => {
    const decision = evaluate(1, { windowStart: MINUTE_START - WINDOW_MS, used: 20 });
    expect(decision).toMatchObject({ allowed: true, state: { windowStart: MINUTE_START, used: 1 } });
  });

  it("starts a new window on the first instant of the next minute", () => {
    const decision = evaluate(1, { windowStart: MINUTE_START, used: 20 }, 20, MINUTE_START + WINDOW_MS);
    expect(decision).toMatchObject({ allowed: true, state: { windowStart: MINUTE_START + WINDOW_MS, used: 1 } });
  });

  it("tells a stroke bigger than the limit that waiting will not help", () => {
    const decision = evaluate(21, undefined);
    expect(decision).toMatchObject({ allowed: false, reason: "larger_than_limit", retryAfterSeconds: 0 });
  });

  it("lets nobody draw with a limit of 0", () => {
    expect(evaluate(1, undefined, 0)).toMatchObject({ allowed: false, reason: "larger_than_limit" });
  });

  it("applies a limit higher than the default", () => {
    expect(evaluate(100, undefined, 500)).toMatchObject({ allowed: true, remaining: 400 });
  });
});

describe("limits", () => {
  it("defaults to 20 pixels per minute", () => {
    expect(DEFAULT_RATE_LIMIT_PER_MINUTE).toBe(20);
    expect(resolveLimit(undefined)).toBe(20);
  });

  it("prefers the admin override, even 0", () => {
    expect(resolveLimit(5)).toBe(5);
    expect(resolveLimit(0)).toBe(0);
  });

  it.each([0, 1, 100])("accepts the limit %i", (value) => {
    expect(parseLimit(value)).toEqual({ ok: true, value });
  });

  it.each([-1, 1.5, Number.NaN, "5", null, undefined])("rejects the limit %j", (value) => {
    expect(parseLimit(value).ok).toBe(false);
  });
});
