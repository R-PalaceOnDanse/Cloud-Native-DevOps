import { describe, expect, it } from "vitest";
import { decodePushBody, parseEnvelope, toPubsubMessage, type PubsubMessage } from "./pubsub.js";
import {
  discordCommandEvent,
  FIXED_CORRELATION_ID,
  FIXED_EVENT_ID,
  pixelDrawEvent,
  snapshotRequestedEvent,
} from "./fixtures.js";

function withAttribute(message: PubsubMessage, key: string, value: string | undefined): PubsubMessage {
  const others = Object.entries(message.attributes).filter(([name]) => name !== key);
  const attributes = Object.fromEntries(value === undefined ? others : [...others, [key, value]]);
  return { ...message, attributes };
}

describe("toPubsubMessage and parseEnvelope", () => {
  it.each([
    ["pixel.draw", pixelDrawEvent],
    ["discord.command", discordCommandEvent],
    ["snapshot.requested", snapshotRequestedEvent],
  ] as const)("round-trips a %s event", (_name, event) => {
    expect(parseEnvelope(toPubsubMessage(event))).toEqual({ ok: true, value: event });
  });

  it("carries the identifying fields as attributes", () => {
    expect(toPubsubMessage(pixelDrawEvent).attributes).toEqual({
      eventId: FIXED_EVENT_ID,
      eventType: "pixel.draw",
      correlationId: FIXED_CORRELATION_ID,
      occurredAt: "2026-10-23T12:00:00.000Z",
      schemaVersion: "1",
    });
  });

  it.each(["eventId", "eventType", "correlationId", "occurredAt", "schemaVersion"])(
    "rejects a message without the %s attribute",
    (key) => {
      const result = parseEnvelope(withAttribute(toPubsubMessage(pixelDrawEvent), key, undefined));
      expect(result.ok).toBe(false);
    },
  );

  it("rejects an unsupported schema version", () => {
    const result = parseEnvelope(withAttribute(toPubsubMessage(pixelDrawEvent), "schemaVersion", "2"));
    expect(result).toEqual({ ok: false, reason: "unsupported schemaVersion 2" });
  });

  it("rejects an unknown event type", () => {
    const result = parseEnvelope(withAttribute(toPubsubMessage(pixelDrawEvent), "eventType", "pixel.erase"));
    expect(result.ok).toBe(false);
  });

  it("rejects data that is not JSON", () => {
    expect(parseEnvelope({ ...toPubsubMessage(pixelDrawEvent), data: "{nope" })).toEqual({
      ok: false,
      reason: "data is not valid JSON",
    });
  });

  it("rejects a draw without pixels", () => {
    const message = { ...toPubsubMessage(pixelDrawEvent), data: JSON.stringify({ source: "web", userId: "u", pixels: [] }) };
    expect(parseEnvelope(message).ok).toBe(false);
  });

  it("rejects a pixel with a fractional coordinate", () => {
    const payload = { source: "web", userId: "u", pixels: [{ x: 1.5, y: 2, color: "#000000" }] };
    const message = { ...toPubsubMessage(pixelDrawEvent), data: JSON.stringify(payload) };
    expect(parseEnvelope(message).ok).toBe(false);
  });

  it("rejects a command whose reply is missing", () => {
    const withoutReply = Object.fromEntries(
      Object.entries(discordCommandEvent.payload).filter(([name]) => name !== "reply"),
    );
    const message = { ...toPubsubMessage(discordCommandEvent), data: JSON.stringify(withoutReply) };
    expect(parseEnvelope(message)).toEqual({ ok: false, reason: "reply must be an object" });
  });

  it("rejects a command option that is not a scalar", () => {
    const payload = { ...discordCommandEvent.payload, options: { user: { id: 1 } } };
    const message = { ...toPubsubMessage(discordCommandEvent), data: JSON.stringify(payload) };
    expect(parseEnvelope(message).ok).toBe(false);
  });
});

describe("decodePushBody", () => {
  it("reads the body posted by a push subscription", () => {
    const message = toPubsubMessage(snapshotRequestedEvent);
    const body = {
      message: { data: Buffer.from(message.data, "utf8").toString("base64"), attributes: message.attributes },
      subscription: "projects/p/subscriptions/s",
    };
    expect(decodePushBody(body)).toEqual({ ok: true, value: message });
  });

  it.each([null, "text", {}, { message: "x" }, { message: {} }])("rejects the body %j", (body) => {
    expect(decodePushBody(body).ok).toBe(false);
  });
});
