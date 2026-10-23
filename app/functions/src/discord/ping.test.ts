import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyInteraction } from "./ping.js";

const SPKI_PREFIX_LENGTH = 12;
const TIMESTAMP = "1700000000";

function signedRequest(rawBody: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(SPKI_PREFIX_LENGTH)
    .toString("hex");
  const signatureHex = sign(null, Buffer.from(TIMESTAMP + rawBody), privateKey).toString("hex");
  return { publicKeyHex, signatureHex, timestamp: TIMESTAMP, rawBody };
}

describe("verifyInteraction", () => {
  it("answers a signed PING with a PONG", () => {
    expect(verifyInteraction(signedRequest('{"type":1}'))).toEqual({
      kind: "pong",
      status: 200,
      body: { type: 1 },
    });
  });

  it("rejects a PING whose signature is invalid", () => {
    const request = signedRequest('{"type":1}');
    expect(verifyInteraction({ ...request, signatureHex: "00".repeat(64) })).toEqual({
      kind: "rejected",
      status: 401,
    });
  });

  it("hands over a signed command", () => {
    const result = verifyInteraction(signedRequest('{"type":2,"data":{"name":"draw"}}'));
    expect(result).toEqual({
      kind: "interaction",
      payload: { type: 2, data: { name: "draw" } },
    });
  });

  it("rejects a signed body that is not a JSON object", () => {
    expect(verifyInteraction(signedRequest("[1,2]"))).toEqual({ kind: "rejected", status: 401 });
    expect(verifyInteraction(signedRequest("not json"))).toEqual({ kind: "rejected", status: 401 });
  });
});
