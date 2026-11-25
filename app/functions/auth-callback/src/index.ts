/**
 * Discord OAuth2 Login Callback Cloud Function.
 * Fulfills Issue #79, C07 §3.1 and ADR-0009.
 * 
 * Exchanges Discord authorization code for user profile,
 * strictly discards access token, and returns short-lived session token.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from '@google-cloud/functions-framework';
import { SecretReader, MockSecretReader, EnvSecretReader, SecretManagerSecretReader } from './secrets.js';
import {
  DiscordOAuthClient,
  MockDiscordOAuthClient,
  HttpDiscordOAuthClient,
  OAuthError,
} from './oauth.js';
import { SessionTokenMinter, FirebaseCustomTokenMinter } from './token.js';

export interface AuthCallbackDependencies {
  secretReader: SecretReader;
  oauthClient: DiscordOAuthClient;
  tokenMinter: SessionTokenMinter;
  clientId: string;
  defaultRedirectUri: string;
  stateValidator?: (state: string) => boolean;
}

export function createAuthCallbackHandler(deps: AuthCallbackDependencies) {
  return async function authCallback(req: Request, res: Response): Promise<void> {
    // The frontend calls the gateway from its own origin: answer the CORS preflight.
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Correlation-ID');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // 1. Only allow GET and POST methods
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
      return;
    }

    // 2. Correlation ID propagation
    const incomingCorrelationId = req.header('X-Correlation-ID');
    const correlationId = incomingCorrelationId && incomingCorrelationId.trim().length > 0
      ? incomingCorrelationId.trim()
      : randomUUID();

    res.setHeader('X-Correlation-ID', correlationId);

    // 3. Extract parameters from query (GET) or body (POST)
    const code = (req.method === 'GET' ? req.query?.code : req.body?.code) as string | undefined;
    const state = (req.method === 'GET' ? req.query?.state : req.body?.state) as string | undefined;
    // The redirect URI is the one registered on the Discord application: a caller cannot choose where
    // the session token is sent (open redirect). Discord rejects a code issued for another URI anyway.
    const redirectUri = deps.defaultRedirectUri;

    // 4. Validate State (Anti-CSRF requirement, Issue #79)
    if (!state || typeof state !== 'string' || state.trim().length === 0) {
      res.status(400).json({
        error: 'Missing state parameter for anti-CSRF verification.',
        code: 'state_missing',
        correlationId,
      });
      return;
    }

    if (deps.stateValidator && !deps.stateValidator(state.trim())) {
      res.status(400).json({
        error: 'State mismatch. Possible CSRF attack detected.',
        code: 'state_mismatch',
        correlationId,
      });
      return;
    }

    // 5. Validate Authorization Code
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({
        error: 'Missing authorization code.',
        code: 'code_missing',
        correlationId,
      });
      return;
    }

    // 6. Retrieve Client Secret securely
    let clientSecret: string;
    try {
      clientSecret = await deps.secretReader.getDiscordClientSecret();
    } catch (err) {
      res.status(500).json({
        error: 'Internal configuration error: failed to retrieve OAuth client secret.',
        correlationId,
      });
      return;
    }

    // 7. Exchange Code with Discord & fetch user profile
    try {
      const user = await deps.oauthClient.exchangeCode(
        code.trim(),
        redirectUri,
        clientSecret,
        deps.clientId
      );

      // 8. Mint short-lived session token (1 hour duration)
      const session = await deps.tokenMinter.mintToken(user);

      // 9. Format response: JSON for API / POST / Accept: application/json, or redirect for GET
      const acceptsJson = req.header('Accept')?.includes('application/json') || req.method === 'POST';

      if (acceptsJson) {
        res.status(200).json({
          status: 'authenticated',
          token: session.token,
          expiresIn: session.expiresInSeconds,
          user: {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
          },
          correlationId,
        });
      } else {
        // Browser redirect back to frontend application with token
        const returnUrl = new URL(redirectUri);
        returnUrl.searchParams.set('token', session.token);
        returnUrl.searchParams.set('username', user.username);
        returnUrl.searchParams.set('id', user.id);
        res.redirect(302, returnUrl.toString());
      }
    } catch (err) {
      if (err instanceof OAuthError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          correlationId,
        });
        return;
      }

      res.status(500).json({
        error: 'Unexpected server error during authentication callback.',
        correlationId,
      });
    }
  };
}

// Entry point for the Functions Framework. On Cloud Run (K_SERVICE is set) the real clients are
// used and a missing setting fails loudly; the mocks only serve local development.
const onCloudRun = Boolean(process.env.K_SERVICE);

function required(name: string, localDefault: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value.trim();
  if (onCloudRun) {
    // Do not crash the container (the deployment would fail): Discord will refuse the exchange and
    // the error is logged on every request until the setting is fixed.
    console.error(JSON.stringify({ severity: 'ERROR', message: `${name} is not set`, function: 'auth-callback' }));
    return '';
  }
  return localDefault;
}

export const authCallback = createAuthCallbackHandler({
  // The client secret is read from Secret Manager at request time (infra/serverless/secrets.tf).
  secretReader: onCloudRun
    ? new SecretManagerSecretReader(process.env.DISCORD_CLIENT_SECRET_VERSION ?? '')
    : process.env.DISCORD_CLIENT_SECRET
      ? new EnvSecretReader('DISCORD_CLIENT_SECRET')
      : new MockSecretReader(),
  oauthClient: onCloudRun ? new HttpDiscordOAuthClient() : new MockDiscordOAuthClient(),
  tokenMinter: new FirebaseCustomTokenMinter(),
  clientId: required('DISCORD_CLIENT_ID', 'mock-discord-client-id'),
  defaultRedirectUri: required('DISCORD_REDIRECT_URI', 'http://localhost:5173/'),
});
