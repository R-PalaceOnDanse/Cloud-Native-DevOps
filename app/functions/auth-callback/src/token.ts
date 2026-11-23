/**
 * Session Token Minter.
 * Generates short-lived session tokens (Firebase Custom Token or signed session token).
 * Fulfills ADR-0009: 1-hour expiration, carries Discord identity.
 */

import { createHmac } from 'node:crypto';
import type { DiscordUserProfile } from './oauth.js';

export interface SessionTokenResult {
  token: string;
  expiresInSeconds: number;
}

export interface SessionTokenMinter {
  mintToken(user: DiscordUserProfile): Promise<SessionTokenResult>;
}

export class HmacSessionTokenMinter implements SessionTokenMinter {
  private readonly secretKey: string;
  private readonly expirationSeconds: number;

  constructor(secretKey = 'dev-session-signing-secret', expirationSeconds = 3600) {
    this.secretKey = secretKey;
    this.expirationSeconds = expirationSeconds;
  }

  async mintToken(user: DiscordUserProfile): Promise<SessionTokenResult> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      uid: `discord:${user.id}`,
      sub: user.id,
      username: user.username,
      iat: now,
      exp: now + this.expirationSeconds,
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const signature = createHmac('sha256', this.secretKey)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');

    return {
      token: `${b64Header}.${b64Payload}.${signature}`,
      expiresInSeconds: this.expirationSeconds,
    };
  }
}
