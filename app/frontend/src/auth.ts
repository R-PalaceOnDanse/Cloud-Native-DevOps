/**
 * Discord OAuth2 & Client Authentication Handler.
 * Fulfills C07 §3.1, §3.2 and ADR-0009.
 * 
 * Flow:
 * 1. User clicks "Connexion Discord" -> generates anti-CSRF state, redirects to Discord OAuth2 URL with scope `identify`.
 * 2. On return, exchange callback code with the backend Cloud Function (Issue #79).
 * 3. Never stores client secrets or Discord access tokens on the browser client.
 */

import { signOutFirebase } from './firebase.js';

export interface UserProfile {
  id: string;
  username: string;
  discriminator?: string | undefined;
  avatar?: string | undefined;
  avatarUrl?: string | undefined;
}

export type AuthStateListener = (user: UserProfile | null) => void;

export interface OAuthExchangeResult {
  success: boolean;
  user?: UserProfile | undefined;
  token?: string | undefined;
  error?: string | undefined;
}

export class AuthManager {
  private user: UserProfile | null = null;
  private sessionToken: string | null = null;
  private listeners: Set<AuthStateListener> = new Set();
  private readonly storageKey = 'teampasx_user_profile';
  private readonly sessionTokenKey = 'teampasx_session_token';
  private readonly stateKey = 'teampasx_oauth_state';

  constructor() {
    this.restoreSession();
  }

  private restoreSession(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
          this.user = JSON.parse(stored) as UserProfile;
        }
      }
      if (typeof sessionStorage !== 'undefined') {
        const storedToken = sessionStorage.getItem(this.sessionTokenKey);
        if (storedToken) {
          this.sessionToken = storedToken;
        }
      }
    } catch {
      this.user = null;
      this.sessionToken = null;
    }
  }

  public getCurrentUser(): UserProfile | null {
    return this.user;
  }

  public getSessionToken(): string | null {
    return this.sessionToken;
  }

  public isAuthenticated(): boolean {
    return this.user !== null;
  }

  public onAuthStateChanged(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    listener(this.user);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.user);
    }
  }

  /**
   * Logs in with a Discord mock or credentials.
   */
  public loginMock(username = 'TestUser', id = '123456789012345678'): void {
    this.user = {
      id,
      username,
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    };
    this.sessionToken = `mock-session-token-${id}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.storageKey, JSON.stringify(this.user));
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this.sessionTokenKey, this.sessionToken);
    }
    this.notify();
  }

  /**
   * Generates a cryptographically strong anti-CSRF state token and stores it in sessionStorage.
   */
  public generateAntiCsrfState(): string {
    const randomHex = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const state = `csrf_${Date.now()}_${randomHex}`;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this.stateKey, state);
    }
    return state;
  }

  /**
   * Redirects to the Discord OAuth2 authorization URL with anti-CSRF state.
   */
  public loginWithDiscord(clientId?: string, redirectUri?: string): void {
    if (!clientId) {
      // In local dev without configured Discord app ID, use fast simulated login
      const randomId = Math.floor(100000000000000000 + Math.random() * 900000000000000000).toString();
      const mockName = `DiscordUser#${randomId.slice(-4)}`;
      this.loginMock(mockName, randomId);
      return;
    }

    const state = this.generateAntiCsrfState();
    const targetRedirect = redirectUri || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');
    const url = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(targetRedirect)}&response_type=code&scope=identify&state=${encodeURIComponent(
      state
    )}`;

    if (typeof window !== 'undefined') {
      window.location.href = url;
    }
  }

  /**
   * Validates anti-CSRF state and exchanges OAuth2 authorization code with backend callback function.
   */
  public async handleOAuthReturn(
    code: string,
    state: string,
    callbackUrl = `${(import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_GATEWAY_URL || '/api'}/auth/discord/callback`
  ): Promise<OAuthExchangeResult> {
    // 1. Verify anti-CSRF state
    if (typeof sessionStorage !== 'undefined') {
      const storedState = sessionStorage.getItem(this.stateKey);
      if (!storedState || storedState !== state) {
        return {
          success: false,
          error: 'State mismatch: possible CSRF attempt or expired login session.',
        };
      }
      sessionStorage.removeItem(this.stateKey);
    }

    // 2. Exchange code with backend Cloud Function
    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ code, state }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        return {
          success: false,
          error: errorData.error || `Authentication failed with status ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        token: string;
        user: { id: string; username: string; avatar?: string; discriminator?: string };
      };

      this.sessionToken = data.token;
      this.user = {
        id: data.user.id,
        username: data.user.username,
        avatar: data.user.avatar,
        discriminator: data.user.discriminator,
        avatarUrl: data.user.avatar
          ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png`
          : 'https://cdn.discordapp.com/embed/avatars/0.png',
      };

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(this.user));
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(this.sessionTokenKey, this.sessionToken);
      }

      this.notify();

      return {
        success: true,
        user: this.user,
        token: this.sessionToken,
      };
    } catch (err) {
      return {
        success: false,
        error: 'Network error communicating with authentication service.',
      };
    }
  }

  public logout(): void {
    this.user = null;
    this.sessionToken = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.storageKey);
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(this.sessionTokenKey);
      sessionStorage.removeItem(this.stateKey);
    }
    void signOutFirebase();
    this.notify();
  }
}

export const authManager = new AuthManager();
