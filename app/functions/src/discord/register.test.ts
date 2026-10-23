import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.js";
import { registerCommands } from "./register.js";

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(status: number, calls: Call[]): typeof fetch {
  return (input, init) => {
    calls.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init });
    return Promise.resolve(new Response("[]", { status }));
  };
}

function bodyText(call: Call | undefined): string {
  const body = call?.init?.body;
  if (typeof body !== "string") {
    throw new Error("the request has no text body");
  }
  return body;
}

const target = { applicationId: "123", botToken: "bot-token-placeholder" };

describe("registerCommands", () => {
  it("overwrites the global commands with the whole list", async () => {
    const calls: Call[] = [];
    const result = await registerCommands(target, { fetch: fakeFetch(200, calls) });
    expect(result).toEqual({ ok: true, value: COMMANDS.length });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://discord.com/api/v10/applications/123/commands");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(bodyText(calls[0]))).toEqual(COMMANDS);
  });

  it("targets one server when a server ID is given", async () => {
    const calls: Call[] = [];
    await registerCommands({ ...target, guildId: "456" }, { fetch: fakeFetch(200, calls) });
    expect(calls[0]?.url).toBe("https://discord.com/api/v10/applications/123/guilds/456/commands");
  });

  it("authenticates as the bot", async () => {
    const calls: Call[] = [];
    await registerCommands(target, { fetch: fakeFetch(200, calls) });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bot bot-token-placeholder");
  });

  it("reports a refusal without exposing the token", async () => {
    const result = await registerCommands(target, { fetch: fakeFetch(401, []) });
    expect(result).toEqual({ ok: false, reason: "Discord answered 401" });
    expect(JSON.stringify(result)).not.toContain("bot-token-placeholder");
  });

  it("reports a network failure", async () => {
    const failing: typeof fetch = () => Promise.reject(new Error("offline"));
    expect(await registerCommands(target, { fetch: failing })).toEqual({
      ok: false,
      reason: "could not reach Discord",
    });
  });

  it("sends the same request when run twice", async () => {
    const calls: Call[] = [];
    await registerCommands(target, { fetch: fakeFetch(200, calls) });
    await registerCommands(target, { fetch: fakeFetch(200, calls) });
    expect(calls[0]?.init?.body).toBe(calls[1]?.init?.body);
  });
});
