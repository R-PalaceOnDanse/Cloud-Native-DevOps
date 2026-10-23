import { createPublicKey, verify } from "node:crypto";

/** DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form; the 32-byte key follows. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

export interface SignedRequest {
  /** Hex-encoded Ed25519 public key of the Discord application. */
  readonly publicKeyHex: string;
  /** Value of the X-Signature-Ed25519 header. */
  readonly signatureHex: string;
  /** Value of the X-Signature-Timestamp header. */
  readonly timestamp: string;
  /** Request body exactly as received, before any parsing. */
  readonly rawBody: string;
}

function decodeHex(value: string, expectedBytes: number): Buffer | undefined {
  if (value.length !== expectedBytes * 2 || !HEX_PATTERN.test(value)) {
    return undefined;
  }
  return Buffer.from(value, "hex");
}

/**
 * Checks that Discord signed this request. The signature covers the timestamp followed by the
 * raw body. Any malformed input is reported as invalid; it never throws.
 */
export function verifyDiscordSignature(request: SignedRequest): boolean {
  const publicKey = decodeHex(request.publicKeyHex, ED25519_PUBLIC_KEY_BYTES);
  const signature = decodeHex(request.signatureHex, ED25519_SIGNATURE_BYTES);
  if (publicKey === undefined || signature === undefined) {
    return false;
  }
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
    format: "der",
    type: "spki",
  });
  const signedData = Buffer.from(request.timestamp + request.rawBody, "utf8");
  return verify(null, signedData, key, signature);
}
