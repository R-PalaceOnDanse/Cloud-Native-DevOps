/**
 * Session token minter (ADR-0009, Issue #79, #167).
 *
 * Production mints a Firebase custom token for the UID `discord:<id>` with the claim `name`. The
 * browser exchanges it with signInWithCustomToken for a Firebase ID token (1 hour, refreshed by the
 * SDK), which the Firestore rules accept for reading the grid and API Gateway verifies on /draw.
 * No signing secret exists anywhere: firebase-admin signs through the IAM signBlob API with the
 * function's own service account. The Discord access token is never kept.
 */

import type { DiscordUserProfile } from './oauth.js';

export interface SessionTokenResult {
  token: string;
  expiresInSeconds: number;
}

export interface SessionTokenMinter {
  mintToken(user: DiscordUserProfile): Promise<SessionTokenResult>;
}

export function firebaseUid(discordUserId: string): string {
  return `discord:${discordUserId}`;
}

export class FirebaseCustomTokenMinter implements SessionTokenMinter {
  private auth: import('firebase-admin/auth').Auth | undefined;

  async mintToken(user: DiscordUserProfile): Promise<SessionTokenResult> {
    if (!this.auth) {
      const [{ initializeApp, getApps }, { getAuth }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth')]);
      const app = getApps()[0] ?? initializeApp();
      this.auth = getAuth(app);
    }
    const token = await this.auth.createCustomToken(firebaseUid(user.id), { name: user.username });
    // A custom token is only valid one hour for the exchange; the session lasts as long as Firebase keeps it.
    return { token, expiresInSeconds: 3600 };
  }
}

/** Deterministic minter for the tests. */
export class FakeTokenMinter implements SessionTokenMinter {
  async mintToken(user: DiscordUserProfile): Promise<SessionTokenResult> {
    return { token: `test-custom-token.${firebaseUid(user.id)}.${user.username}`, expiresInSeconds: 3600 };
  }
}
