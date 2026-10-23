import { describe, expect, it } from "vitest";
import { isCorrelationId, isEventId, newCorrelationId, newEventId, resolveCorrelationId } from "./ids.js";

describe("ids", () => {
  it("creates unique event IDs that are UUIDs", () => {
    const first = newEventId();
    expect(isEventId(first)).toBe(true);
    expect(newEventId()).not.toBe(first);
  });

  it("creates correlation IDs that pass their own check", () => {
    expect(isCorrelationId(newCorrelationId())).toBe(true);
  });

  it("keeps a supplied correlation ID of a safe shape", () => {
    expect(resolveCorrelationId("req-2026.10.23_abc")).toBe("req-2026.10.23_abc");
  });

  it.each([undefined, "", "short", "has space in it", "line\nbreak-injection", "x".repeat(65)])(
    "replaces the unusable value %j",
    (supplied) => {
      const resolved = resolveCorrelationId(supplied);
      expect(resolved).not.toBe(supplied);
      expect(isCorrelationId(resolved)).toBe(true);
    },
  );

  it("rejects an event ID that is not a UUID", () => {
    expect(isEventId("not-a-uuid")).toBe(false);
  });
});
