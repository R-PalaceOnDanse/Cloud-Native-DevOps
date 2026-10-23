import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLogger, type AnyEventEnvelope } from "../events/index.js";
import { handleDiscordRequest, type ProxyDeps, type ProxyRequest } from "./proxy.js";

const SPKI_PREFIX_LENGTH = 12;
const TIMESTAMP = "1700000000";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX_LENGTH).toString("hex");

function signed(payload: unknown, extraHeaders: Record<string, string> = {}): ProxyRequest {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    headers: {
      "x-signature-timestamp": TIMESTAMP,
      "x-signature-ed25519": sign(null, Buffer.from(TIMESTAMP + rawBody), privateKey).toString("hex"),
      ...extraHeaders,
    },
  };
}

function setup(publishError?: Error) {
  const published: AnyEventEnvelope[] = [];
  const logs: Record<string, unknown>[] = [];
  const deps: ProxyDeps = {
    publicKeyHex,
    publish: (event) => {
      if (publishError !== undefined) {
        return Promise.reject(publishError);
      }
      published.push(event);
      return Promise.resolve();
    },
    loggerFor: (correlationId) =>
      createLogger({ functionName: "discord-proxy", correlationId, write: (line) => { logs.push(JSON.parse(line) as Record<string, unknown>); } }),
  };
  return { deps, published, logs };
}

const command = (name: string, options?: unknown[]) => ({
  type: 2,
  application_id: "app-1",
  token: "interaction-token-placeholder",
  guild_id: "g-1",
  channel_id: "c-1",
  member: { user: { id: "u-1" }, roles: ["r-1"] },
  data: { name, ...(options === undefined ? {} : { options }) },
});

describe("handleDiscordRequest", () => {
  it("answers a signed PING with a PONG and publishes nothing", async () => {
    const { deps, published } = setup();
    expect(await handleDiscordRequest(deps, signed({ type: 1 }))).toEqual({ status: 200, body: { type: 1 } });
    expect(published).toHaveLength(0);
  });

  it("refuses a request without signature headers", async () => {
    const { deps, published } = setup();
    expect(await handleDiscordRequest(deps, { rawBody: '{"type":1}', headers: {} })).toEqual({ status: 401 });
    expect(published).toHaveLength(0);
  });

  it("refuses a request whose body was changed after signing", async () => {
    const { deps, published } = setup();
    const request = signed(command("get"));
    expect(await handleDiscordRequest(deps, { ...request, rawBody: request.rawBody.replace("get", "gex") })).toEqual({ status: 401 });
    expect(published).toHaveLength(0);
  });

  it("turns /draw into a pixel.draw event and defers the answer", async () => {
    const { deps, published } = setup();
    const response = await handleDiscordRequest(
      deps,
      signed(command("draw", [{ name: "x", type: 4, value: 10 }, { name: "y", type: 4, value: 20 }, { name: "color", type: 3, value: "red" }])),
    );
    expect(response).toEqual({ status: 200, body: { type: 5 } });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      eventType: "pixel.draw",
      payload: {
        source: "discord",
        userId: "u-1",
        pixels: [{ x: 10, y: 20, color: "red" }],
        reply: { applicationId: "app-1", interactionToken: "interaction-token-placeholder" },
      },
    });
  });

  it.each([["get", undefined], ["snapshot", undefined], ["admin", [{ name: "pause", type: 1 }]]])(
    "turns /%s into a discord.command event",
    async (name, options) => {
      const { deps, published } = setup();
      const response = await handleDiscordRequest(deps, signed(command(name, options)));
      expect(response).toEqual({ status: 200, body: { type: 5 } });
      expect(published[0]).toMatchObject({ eventType: "discord.command", payload: { commandName: name, userId: "u-1", roleIds: ["r-1"] } });
    },
  );

  it("keeps the subcommand and options of /admin ratelimit", async () => {
    const { deps, published } = setup();
    await handleDiscordRequest(
      deps,
      signed(command("admin", [{ name: "ratelimit", type: 1, options: [{ name: "user", type: 6, value: "u-2" }, { name: "limit", type: 4, value: 5 }] }])),
    );
    expect(published[0]).toMatchObject({ payload: { subcommand: "ratelimit", options: { user: "u-2", limit: 5 } } });
  });

  it("answers privately, without publishing, when /draw lacks its options", async () => {
    const { deps, published } = setup();
    const response = await handleDiscordRequest(deps, signed(command("draw", [{ name: "x", type: 4, value: 1 }])));
    expect(response).toEqual({ status: 200, body: { type: 4, data: { content: "Usage: /draw x y color", flags: 64 } } });
    expect(published).toHaveLength(0);
  });

  it("answers privately when an interaction is not a slash command", async () => {
    const { deps, published } = setup();
    const response = await handleDiscordRequest(deps, signed({ type: 3, data: {} }));
    expect(response.body).toMatchObject({ type: 4, data: { flags: 64 } });
    expect(published).toHaveLength(0);
  });

  it("tells the user to retry, and logs the failure, when publishing fails", async () => {
    const { deps, logs } = setup(new Error("broker down"));
    const response = await handleDiscordRequest(deps, signed(command("get")));
    expect(response.body).toMatchObject({ type: 4, data: { content: "Something went wrong, please try again.", flags: 64 } });
    expect(logs.at(-1)).toMatchObject({ severity: "ERROR", message: "could not publish the event", error: "broker down" });
  });

  it("carries one correlation ID from the request to the event and the logs", async () => {
    const { deps, published, logs } = setup();
    await handleDiscordRequest(deps, signed(command("get"), { "x-correlation-id": "request-12345678" }));
    expect(published[0]?.correlationId).toBe("request-12345678");
    expect(logs.every((line) => line["correlation_id"] === "request-12345678")).toBe(true);
  });

  it("creates a correlation ID when the caller gave none, or an unsafe one", async () => {
    const { deps, published } = setup();
    await handleDiscordRequest(deps, signed(command("get"), { "x-correlation-id": "bad value\n" }));
    expect(published[0]?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never logs the interaction token", async () => {
    const { deps, logs } = setup(new Error("broker down"));
    await handleDiscordRequest(deps, signed(command("get")));
    await handleDiscordRequest(deps, signed({ type: 3, data: {} }));
    expect(JSON.stringify(logs)).not.toContain("interaction-token-placeholder");
  });
});
