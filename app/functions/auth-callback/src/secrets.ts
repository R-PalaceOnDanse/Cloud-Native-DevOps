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

/**
 * Reads the client secret from Secret Manager with the function's own identity (accessor on this one
 * secret only), and caches it for the life of the instance.
 * `versionName` = projects/<project>/secrets/discord-client-secret/versions/latest
 */
export class SecretManagerSecretReader implements SecretReader {
  private cached: string | undefined;

  constructor(private readonly versionName: string) {}

  async getDiscordClientSecret(): Promise<string> {
    if (this.cached) return this.cached;
    if (!this.versionName) throw new Error('DISCORD_CLIENT_SECRET_VERSION is not set');
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
    const [version] = await new SecretManagerServiceClient().accessSecretVersion({ name: this.versionName });
    const value = version.payload?.data ? Buffer.from(version.payload.data).toString('utf8').trim() : '';
    if (!value) throw new Error('The Discord client secret has no value yet.');
    this.cached = value;
    return value;
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
