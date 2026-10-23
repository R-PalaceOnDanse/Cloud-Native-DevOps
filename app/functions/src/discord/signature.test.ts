import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDiscordSignature } from "./signature.js";

const SPKI_PREFIX_LENGTH = 12;

function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(SPKI_PREFIX_LENGTH)
    .toString("hex");
  return { publicKeyHex, privateKey };
}

function signedRequest(timestamp: string, rawBody: string) {
  const { publicKeyHex, privateKey } = newKeyPair();
  const signatureHex = sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
  return { publicKeyHex, signatureHex, timestamp, rawBody };
}

describe("verifyDiscordSignature", () => {
  it("accepts a request signed by the application key", () => {
    expect(verifyDiscordSignature(signedRequest("1700000000", '{"type":1}'))).toBe(true);
  });

  it("rejects a body changed after signing", () => {
    const request = signedRequest("1700000000", '{"type":1}');
    expect(verifyDiscordSignature({ ...request, rawBody: '{"type":2}' })).toBe(false);
  });

  it("rejects a timestamp changed after signing", () => {
    const request = signedRequest("1700000000", '{"type":1}');
    expect(verifyDiscordSignature({ ...request, timestamp: "1700000001" })).toBe(false);
  });

  it("rejects a signature made with another key", () => {
    const request = signedRequest("1700000000", '{"type":1}');
    const other = newKeyPair();
    expect(verifyDiscordSignature({ ...request, publicKeyHex: other.publicKeyHex })).toBe(false);
  });

  it("rejects an empty signature", () => {
    const request = signedRequest("1700000000", '{"type":1}');
    expect(verifyDiscordSignature({ ...request, signatureHex: "" })).toBe(false);
  });

  it("rejects a signature that is not hexadecimal", () => {
    const request = signedRequest("1700000000", '{"type":1}');
    expect(verifyDiscordSignature({ ...request, signatureHex: "zz".repeat(64) })).toBe(false);
  });

  it("rejects a public key of the wrong length", () => {
    const request = signedRequest("1700000000", '{"type":1}');
    expect(verifyDiscordSignature({ ...request, publicKeyHex: "ab" })).toBe(false);
  });
});
