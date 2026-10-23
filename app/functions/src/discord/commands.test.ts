import { describe, expect, it } from "vitest";
import { COMMANDS, OptionType, type CommandOption } from "./commands.js";

const NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

function walk(options: readonly CommandOption[] | undefined): CommandOption[] {
  return (options ?? []).flatMap((option) => [option, ...walk(option.options)]);
}

describe("COMMANDS", () => {
  it("defines exactly the commands of the subject", () => {
    expect(COMMANDS.map((command) => command.name)).toEqual(["draw", "get", "snapshot", "admin"]);
    const admin = COMMANDS.find((command) => command.name === "admin");
    expect(admin?.options?.map((option) => option.name)).toEqual(["pause", "resume", "clear", "ratelimit"]);
  });

  it("gives /draw integer coordinates inside the grid and a color", () => {
    const draw = COMMANDS.find((command) => command.name === "draw");
    expect(draw?.options).toEqual([
      expect.objectContaining({ name: "x", type: OptionType.Integer, required: true, min_value: 0, max_value: 9_999 }),
      expect.objectContaining({ name: "y", type: OptionType.Integer, required: true, min_value: 0, max_value: 9_999 }),
      expect.objectContaining({ name: "color", type: OptionType.String, required: true }),
    ]);
  });

  it("gives /admin ratelimit a user and a limit", () => {
    const ratelimit = COMMANDS.find((command) => command.name === "admin")?.options?.find(
      (option) => option.name === "ratelimit",
    );
    expect(ratelimit?.options?.map((option) => [option.name, option.type, option.required])).toEqual([
      ["user", OptionType.User, true],
      ["limit", OptionType.Integer, true],
    ]);
  });

  it("respects Discord's naming and length rules everywhere", () => {
    const everything = [...COMMANDS, ...COMMANDS.flatMap((command) => walk(command.options))];
    for (const item of everything) {
      expect(item.name).toMatch(NAME);
      expect(item.name).toBe(item.name.toLowerCase());
      expect(item.description.length).toBeGreaterThanOrEqual(1);
      expect(item.description.length).toBeLessThanOrEqual(100);
    }
  });

  it("has no duplicate names at one level", () => {
    const names = COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(COMMANDS))).toEqual(COMMANDS);
  });
});
