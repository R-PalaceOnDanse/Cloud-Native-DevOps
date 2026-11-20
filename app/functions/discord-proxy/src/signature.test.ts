import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyDiscordSignature } from './signature.js';

// Une paire de clés de test qui joue le rôle de Discord.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyHex = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('hex');

function signAsDiscord(timestamp: string, body: string): string {
  return sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
}

const timestamp = '1700000000';
const body = '{"type":1}';

test('accepte une signature valide', () => {
  const sig = signAsDiscord(timestamp, body);
  assert.equal(verifyDiscordSignature(publicKeyHex, sig, timestamp, Buffer.from(body)), true);
});

test('refuse un body modifié', () => {
  const sig = signAsDiscord(timestamp, body);
  assert.equal(verifyDiscordSignature(publicKeyHex, sig, timestamp, Buffer.from('{"type":2}')), false);
});

test('refuse un timestamp modifié', () => {
  const sig = signAsDiscord(timestamp, body);
  assert.equal(verifyDiscordSignature(publicKeyHex, sig, '1700000001', Buffer.from(body)), false);
});

test('refuse une signature faite avec une autre clé', () => {
  const other = generateKeyPairSync('ed25519').privateKey;
  const sig = sign(null, Buffer.from(timestamp + body), other).toString('hex');
  assert.equal(verifyDiscordSignature(publicKeyHex, sig, timestamp, Buffer.from(body)), false);
});

test('refuse une signature qui n’est pas du hex valide', () => {
  assert.equal(verifyDiscordSignature(publicKeyHex, 'abc', timestamp, Buffer.from(body)), false);
});