/** Discord's numeric codes, see the application commands reference. */
export const CHAT_INPUT = 1;

export const OptionType = {
  SubCommand: 1,
  SubCommandGroup: 2,
  String: 3,
  Integer: 4,
  Boolean: 5,
  User: 6,
} as const;

export interface CommandOption {
  readonly type: number;
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  readonly min_value?: number;
  readonly max_value?: number;
  readonly options?: readonly CommandOption[];
}

export interface CommandDefinition {
  readonly type: typeof CHAT_INPUT;
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CommandOption[];
}

const LAST_COORDINATE = 9_999;

/**
 * The commands of the subject, exactly: /draw, /get, /snapshot and /admin with its four
 * subcommands. Who may run /snapshot and /admin is decided by the worker, not here.
 */
export const COMMANDS: readonly CommandDefinition[] = [
  {
    type: CHAT_INPUT,
    name: "draw",
    description: "Draw one pixel on the canvas",
    options: [
      { type: OptionType.Integer, name: "x", description: "Column, from 0 to 9999", required: true, min_value: 0, max_value: LAST_COORDINATE },
      { type: OptionType.Integer, name: "y", description: "Row, from 0 to 9999", required: true, min_value: 0, max_value: LAST_COORDINATE },
      { type: OptionType.String, name: "color", description: "A color name (red, blue...) or a hex code like #ff8000", required: true },
    ],
  },
  { type: CHAT_INPUT, name: "get", description: "Show the current canvas as an image" },
  { type: CHAT_INPUT, name: "snapshot", description: "Save a timestamped snapshot of the canvas (admin)" },
  {
    type: CHAT_INPUT,
    name: "admin",
    description: "Administer the canvas (admin)",
    options: [
      { type: OptionType.SubCommand, name: "pause", description: "Stop all drawing" },
      { type: OptionType.SubCommand, name: "resume", description: "Allow drawing again" },
      { type: OptionType.SubCommand, name: "clear", description: "Erase the whole canvas" },
      {
        type: OptionType.SubCommand,
        name: "ratelimit",
        description: "Set how many pixels a user may draw per minute",
        options: [
          { type: OptionType.User, name: "user", description: "The user to change", required: true },
          { type: OptionType.Integer, name: "limit", description: "Pixels per minute, 0 to forbid drawing", required: true, min_value: 0 },
        ],
      },
    ],
  },
];
