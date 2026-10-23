import { describe, expect, it } from "vitest";
import { parseCommandInteraction } from "./interaction.js";

const base = {
  type: 2,
  application_id: "app-1",
  token: "interaction-token-placeholder",
  guild_id: "guild-1",
  channel_id: "channel-1",
  member: { user: { id: "user-1" }, roles: ["role-1", "role-2"] },
};

describe("parseCommandInteraction", () => {
  it("reads a /draw command with its options", () => {
    const result = parseCommandInteraction({
      ...base,
      data: { name: "draw", options: [{ name: "x", type: 4, value: 10 }, { name: "y", type: 4, value: 20 }, { name: "color", type: 3, value: "red" }] },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        applicationId: "app-1",
        interactionToken: "interaction-token-placeholder",
        userId: "user-1",
        roleIds: ["role-1", "role-2"],
        guildId: "guild-1",
        channelId: "channel-1",
        commandName: "draw",
        options: { x: 10, y: 20, color: "red" },
      },
    });
  });

  it("reads a subcommand and its options", () => {
    const result = parseCommandInteraction({
      ...base,
      data: { name: "admin", options: [{ name: "ratelimit", type: 1, options: [{ name: "user", type: 6, value: "user-2" }, { name: "limit", type: 4, value: 5 }] }] },
    });
    expect(result).toMatchObject({ ok: true, value: { commandName: "admin", subcommand: "ratelimit", options: { user: "user-2", limit: 5 } } });
  });

  it("reads a command without options", () => {
    expect(parseCommandInteraction({ ...base, data: { name: "get" } })).toMatchObject({
      ok: true,
      value: { commandName: "get", options: {} },
    });
  });

  it("reads the user of a direct message, which has no roles or server", () => {
    const result = parseCommandInteraction({
      type: 2,
      application_id: "app-1",
      token: "interaction-token-placeholder",
      user: { id: "user-9" },
      data: { name: "get" },
    });
    expect(result).toMatchObject({ ok: true, value: { userId: "user-9", roleIds: [] } });
    expect(result.ok && result.value.guildId).toBeUndefined();
  });

  it.each([
    ["not a slash command", { ...base, type: 3, data: { name: "get" } }],
    ["no token", { ...base, token: undefined, data: { name: "get" } }],
    ["no application", { ...base, application_id: undefined, data: { name: "get" } }],
    ["no user", { ...base, member: undefined, data: { name: "get" } }],
    ["no data", { ...base }],
    ["no command name", { ...base, data: {} }],
    ["an option that is not scalar", { ...base, data: { name: "draw", options: [{ name: "x", value: { a: 1 } }] } }],
    ["an unnamed subcommand", { ...base, data: { name: "admin", options: [{ type: 1 }] } }],
  ])("refuses %s", (_label, payload) => {
    expect(parseCommandInteraction(payload).ok).toBe(false);
  });
});
