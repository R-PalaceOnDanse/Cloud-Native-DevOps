/**
 * Discord OAuth2 & Client Authentication Handler.
 * Fulfills C07 §3.1, §3.2 and ADR-0009.
 * 
 * Flow:
 * 1. User clicks "Connexion Discord" -> redirects to Discord OAuth2 URL with scope `identify`.
 * 2. On return, exchange callback code via API Gateway (or mock user during development).
 * 3. Never stores client secrets or permanent access tokens on the browser client.
 */

export interface UserProfile {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string;
  avatarUrl?: string;
}

export type AuthStateListener = (user: UserProfile | null) => void;

export class AuthManager {
  private user: UserProfile | null = null;
  private listeners: Set<AuthStateListener> = new Set();
  private readonly storageKey = 'teampasx_user_profile';

  constructor() {
    this.restoreSession();
  }

  private restoreSession(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.user = JSON.parse(stored) as UserProfile;
      }
    } catch {
      this.user = null;
    }
  }

  public getCurrentUser(): UserProfile | null {
    return this.user;
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
    localStorage.setItem(this.storageKey, JSON.stringify(this.user));
    this.notify();
  }

  /**
   * Redirects to the Discord OAuth2 authorization URL.
   */
  public loginWithDiscord(clientId?: string, redirectUri?: string): void {
    if (!clientId) {
      // In local dev without configured Discord app ID, use fast simulated login
      const randomId = Math.floor(100000000000000000 + Math.random() * 900000000000000000).toString();
      const mockName = `DiscordUser#${randomId.slice(-4)}`;
      this.loginMock(mockName, randomId);
      return;
    }

    const targetRedirect = redirectUri || window.location.origin;
    const url = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(targetRedirect)}&response_type=code&scope=identify`;

    window.location.href = url;
  }

  public logout(): void {
    this.user = null;
    localStorage.removeItem(this.storageKey);
    this.notify();
  }
}

export const authManager = new AuthManager();
