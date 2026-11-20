import { createPublicKey, verify } from "node:crypto";
import { buffer } from "node:stream/consumers";

// check if request is signed by discord
// return true if yes, false for all other cases

export function verifyDiscordSignature(
    publicKeyHex: string,
    signatureHex: string,
    timestamps: string,
    rawBody: Buffer,
) : boolean {
    try {
        //discord give hexadecimal publque key, node expect a key object, convert to readable format JWK
        const publicKey = createPublicKey({
            key: {kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKeyHex, 'hex').toString('base64url') },
            format: 'jwk',
        });
        const message = Buffer.concat([Buffer.from(timestamps, 'utf8'), rawBody]);
        return verify(null, message, publicKey, Buffer.from(signatureHex, 'hex')); // null mean no Ed25519 so not discord
    } catch {
        return false;
    }
}