import {
  createEvent,
  resolveCorrelationId,
  type AnyEventEnvelope,
  type Logger,
} from "../events/index.js";
import { parseCommandInteraction, type CommandInteraction } from "./interaction.js";
import { verifyInteraction } from "./ping.js";

const CALLBACK_DEFERRED_MESSAGE = 5;
const CALLBACK_MESSAGE = 4;
const FLAG_EPHEMERAL = 64;

export interface ProxyRequest {
  /** Header names in lowercase. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** The body exactly as received. */
  readonly rawBody: string;
}

export interface ProxyResponse {
  readonly status: number;
  readonly body?: Readonly<Record<string, unknown>>;
}

export interface ProxyDeps {
  /** Hex Ed25519 public key of the Discord application. */
  readonly publicKeyHex: string;
  /** Sends an event to the broker; the broker adapter decides the topic from the event type. */
  readonly publish: (event: AnyEventEnvelope) => Promise<void>;
  /** A logger for one request, already carrying its correlation ID. */
  readonly loggerFor: (correlationId: string) => Logger;
}

const DEFERRED: ProxyResponse = { status: 200, body: { type: CALLBACK_DEFERRED_MESSAGE } };

function privateMessage(content: string): ProxyResponse {
  return { status: 200, body: { type: CALLBACK_MESSAGE, data: { content, flags: FLAG_EPHEMERAL } } };
}

function toEvent(interaction: CommandInteraction, correlationId: string): BuiltEvent {
  const reply = { applicationId: interaction.applicationId, interactionToken: interaction.interactionToken };
  if (interaction.commandName === "draw") {
    const { x, y, color } = interaction.options;
    if (typeof x !== "number" || typeof y !== "number" || typeof color !== "string") {
      return { ok: false, message: "Usage: /draw x y color" };
    }
    return {
      ok: true,
      event: createEvent({
        eventType: "pixel.draw",
        correlationId,
        payload: { source: "discord", userId: interaction.userId, pixels: [{ x, y, color }], reply },
      }),
    };
  }
  return {
    ok: true,
    event: createEvent({
      eventType: "discord.command",
      correlationId,
      payload: {
        commandName: interaction.commandName,
        ...(interaction.subcommand === undefined ? {} : { subcommand: interaction.subcommand }),
        options: interaction.options,
        userId: interaction.userId,
        roleIds: interaction.roleIds,
        ...(interaction.guildId === undefined ? {} : { guildId: interaction.guildId }),
        ...(interaction.channelId === undefined ? {} : { channelId: interaction.channelId }),
        reply,
      },
    }),
  };
}

type BuiltEvent =
  | { readonly ok: true; readonly event: AnyEventEnvelope }
  | { readonly ok: false; readonly message: string };

/**
 * The Discord proxy, without any Google Cloud client in it. In order: refuse a request Discord did
 * not sign, answer the PING, turn a slash command into one event, publish it, and acknowledge with
 * a deferred response so that Discord gets its answer within 3 seconds. The worker does the rest.
 * Nothing but this validation and the publishing happens during the request.
 */
export async function handleDiscordRequest(deps: ProxyDeps, request: ProxyRequest): Promise<ProxyResponse> {
  const correlationId = resolveCorrelationId(request.headers["x-correlation-id"]);
  const logger = deps.loggerFor(correlationId);

  const timestamp = request.headers["x-signature-timestamp"];
  const signatureHex = request.headers["x-signature-ed25519"];
  if (timestamp === undefined || signatureHex === undefined) {
    logger.warning("request without signature headers");
    return { status: 401 };
  }
  const verified = verifyInteraction({ publicKeyHex: deps.publicKeyHex, signatureHex, timestamp, rawBody: request.rawBody });
  if (verified.kind === "rejected") {
    logger.warning("request with an invalid signature");
    return { status: 401 };
  }
  if (verified.kind === "pong") {
    return { status: 200, body: verified.body };
  }

  const interaction = parseCommandInteraction(verified.payload);
  if (!interaction.ok) {
    logger.warning("interaction refused", { reason: interaction.reason });
    return privateMessage("This interaction is not supported.");
  }
  const built = toEvent(interaction.value, correlationId);
  if (!built.ok) {
    logger.info("command refused", { command: interaction.value.commandName });
    return privateMessage(built.message);
  }
  try {
    await deps.publish(built.event);
  } catch (error) {
    logger.error("could not publish the event", {
      event_id: built.event.eventId,
      event_type: built.event.eventType,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return privateMessage("Something went wrong, please try again.");
  }
  logger.info("event published", { event_id: built.event.eventId, event_type: built.event.eventType, command: interaction.value.commandName });
  return DEFERRED;
}
