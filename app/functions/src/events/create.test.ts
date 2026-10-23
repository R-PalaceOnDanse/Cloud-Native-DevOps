import { describe, expect, it } from "vitest";
import { createEvent } from "./create.js";
import { isEventId } from "./ids.js";
import { FIXED_CORRELATION_ID, FIXED_NOW, pixelDrawPayload } from "./fixtures.js";

describe("createEvent", () => {
  it("fills the envelope from the input and the clock", () => {
    const event = createEvent({
      eventType: "pixel.draw",
      correlationId: FIXED_CORRELATION_ID,
      payload: pixelDrawPayload,
      now: () => FIXED_NOW,
    });
    expect(event.occurredAt).toBe("2026-10-23T12:00:00.000Z");
    expect(event.correlationId).toBe(FIXED_CORRELATION_ID);
    expect(event.payload).toBe(pixelDrawPayload);
    expect(isEventId(event.eventId)).toBe(true);
  });

  it("gives each event its own ID", () => {
    const input = { eventType: "pixel.draw", correlationId: FIXED_CORRELATION_ID, payload: pixelDrawPayload } as const;
    expect(createEvent(input).eventId).not.toBe(createEvent(input).eventId);
  });
});
