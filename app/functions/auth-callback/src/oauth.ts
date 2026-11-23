/**
 * Discord OAuth2 Client.
 * Exchanges authorization code for user profile with 'identify' scope.
 * 
 * CRITICAL REQUIREMENT (C07 §3.1, ADR-0009, Issue #79):
 * The Discord access token is strictly discarded and never stored or returned.
 */

export interface DiscordUserProfile {
  id: string;
  username: string;
  discriminator?: string | undefined;
  avatar?: string | undefined;
}

export class OAuthError extends Error {
  readonly code: 'bad_code' | 'state_mismatch' | 'upstream_error' | 'invalid_request';
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: 'bad_code' | 'state_mismatch' | 'upstream_error' | 'invalid_request',
    message: string,
    status = 400,
    details?: unknown
  ) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface DiscordOAuthClient {
  exchangeCode(
    code: string,
    redirectUri: string,
    clientSecret: string,
    clientId: string
  ): Promise<DiscordUserProfile>;
}

export class HttpDiscordOAuthClient implements DiscordOAuthClient {
  private readonly tokenEndpoint: string;
  private readonly userEndpoint: string;

  constructor(
    tokenEndpoint = 'https://discord.com/api/oauth2/token',
    userEndpoint = 'https://discord.com/api/users/@me'
  ) {
    this.tokenEndpoint = tokenEndpoint;
    this.userEndpoint = userEndpoint;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
    clientSecret: string,
    clientId: string
  ): Promise<DiscordUserProfile> {
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
      });
    } catch (err) {
      throw new OAuthError('upstream_error', 'Failed to reach Discord token endpoint.', 502, err);
    }

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      let parsedError: Record<string, unknown> = {};
      try {
        parsedError = JSON.parse(errorBody);
      } catch {
        // Fallback for non-JSON response
      }

      if (tokenResponse.status === 400) {
        throw new OAuthError('bad_code', 'Invalid or expired authorization code.', 400, parsedError);
      }
      throw new OAuthError(
        'upstream_error',
        `Discord OAuth token request failed (${tokenResponse.status}).`,
        502,
        parsedError
      );
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string; token_type?: string };
    const rawAccessToken = tokenData.access_token;
    if (!rawAccessToken) {
      throw new OAuthError('upstream_error', 'Discord did not return an access token.', 502);
    }

    // 2. Fetch user profile with the short-lived access token
    let userResponse: Response;
    try {
      userResponse = await fetch(this.userEndpoint, {
        headers: {
          Authorization: `Bearer ${rawAccessToken}`,
        },
      });
    } catch (err) {
      throw new OAuthError('upstream_error', 'Failed to reach Discord user endpoint.', 502, err);
    }

    if (!userResponse.ok) {
      throw new OAuthError(
        'upstream_error',
        `Failed to fetch Discord user profile (${userResponse.status}).`,
        502
      );
    }

    const userData = (await userResponse.json()) as {
      id: string;
      username: string;
      discriminator?: string;
      avatar?: string;
    };

    // 3. DISCARD access_token: rawAccessToken goes out of scope here.
    // The access token is never persisted or returned.
    return {
      id: userData.id,
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar,
    };
  }
}

export class MockDiscordOAuthClient implements DiscordOAuthClient {
  private validCodes: Map<string, DiscordUserProfile> = new Map();
  private simulateUpstreamError = false;

  constructor() {
    this.validCodes.set('valid-auth-code-123', {
      id: 'mock-discord-user-id-alpha',
      username: 'DiscordArtist',
      discriminator: '0001',
      avatar: 'a_1234567890abcdef',
    });
  }

  setSimulateUpstreamError(error: boolean): void {
    this.simulateUpstreamError = error;
  }

  registerCode(code: string, user: DiscordUserProfile): void {
    this.validCodes.set(code, user);
  }

  async exchangeCode(
    code: string,
    _redirectUri: string,
    _clientSecret: string,
    _clientId: string
  ): Promise<DiscordUserProfile> {
    if (this.simulateUpstreamError) {
      throw new OAuthError('upstream_error', 'Simulated Discord service failure.', 502);
    }

    const user = this.validCodes.get(code);
    if (!user) {
      throw new OAuthError('bad_code', 'Invalid or expired authorization code.', 400);
    }

    // Returns user profile only; zero access token retained
    return { ...user };
  }
}
