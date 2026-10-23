import { verifyDiscordSignature, type SignedRequest } from "./signature.js";

const INTERACTION_TYPE_PING = 1;
const CALLBACK_TYPE_PONG = 1;

export type VerifiedInteraction =
  | { readonly kind: "rejected"; readonly status: 401 }
  | { readonly kind: "pong"; readonly status: 200; readonly body: { readonly type: 1 } }
  | { readonly kind: "interaction"; readonly payload: Readonly<Record<string, unknown>> };

function parseObject(rawBody: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * First step of the proxy: nothing is parsed before the signature is valid, a PING gets its PONG,
 * and any other interaction is handed over to the caller.
 */
export function verifyInteraction(request: SignedRequest): VerifiedInteraction {
  if (!verifyDiscordSignature(request)) {
    return { kind: "rejected", status: 401 };
  }
  const payload = parseObject(request.rawBody);
  if (payload === undefined) {
    return { kind: "rejected", status: 401 };
  }
  if (payload["type"] === INTERACTION_TYPE_PING) {
    return { kind: "pong", status: 200, body: { type: CALLBACK_TYPE_PONG } };
  }
  return { kind: "interaction", payload };
}
