/**
 * Secret Reader for Discord OAuth2 credentials.
 * Fulfills Issue #79, ADR-0009 and ADR-0015.
 */

export interface SecretReader {
  getDiscordClientSecret(): Promise<string>;
}

export class EnvSecretReader implements SecretReader {
  private readonly envVarName: string;

  constructor(envVarName = 'DISCORD_CLIENT_SECRET') {
    this.envVarName = envVarName;
  }

  async getDiscordClientSecret(): Promise<string> {
    const secret = process.env[this.envVarName];
    if (!secret || secret.trim().length === 0) {
      throw new Error(`Secret environment variable '${this.envVarName}' is not set or empty.`);
    }
    return secret.trim();
  }
}

export class MockSecretReader implements SecretReader {
  private secret: string | null;

  constructor(secret: string | null = 'mock-discord-secret-xyz-123') {
    this.secret = secret;
  }

  async getDiscordClientSecret(): Promise<string> {
    if (this.secret === null) {
      throw new Error('Secret Manager service unavailable or secret not found.');
    }
    return this.secret;
  }

  setSecret(secret: string | null): void {
    this.secret = secret;
  }
}
