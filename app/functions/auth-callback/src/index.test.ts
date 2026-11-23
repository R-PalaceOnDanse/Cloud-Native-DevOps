/**
 * Unit tests for Discord OAuth2 Login Callback Function.
 * Fulfills Issue #79 Acceptance Criteria:
 * - Authorization code flow with identify scope
 * - Discord access token is discarded, never stored
 * - Function returns short-lived session token, redirect URL registered
 * - Tests cover a bad code and a state mismatch
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from '@google-cloud/functions-framework';
import { createAuthCallbackHandler } from './index.js';
import { MockSecretReader } from './secrets.js';
import { MockDiscordOAuthClient } from './oauth.js';
import { HmacSessionTokenMinter } from './token.js';

function createMockHttp(reqOverrides: Partial<Request> = {}) {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let jsonBody: unknown = null;
  let redirectedUrl: string | null = null;
  let redirectedStatus: number | null = null;

  const reqHeaders: Record<string, string> = {};
  if (reqOverrides.headers) {
    for (const [k, v] of Object.entries(reqOverrides.headers)) {
      if (typeof v === 'string') {
        reqHeaders[k.toLowerCase()] = v;
      }
    }
  }

  const req = {
    method: 'GET',
    headers: reqHeaders,
    query: {},
    body: {},
    header(name: string) {
      return reqHeaders[name.toLowerCase()];
    },
    ...reqOverrides,
  } as unknown as Request;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      return this;
    },
    redirect(statusOrUrl: number | string, optUrl?: string) {
      if (typeof statusOrUrl === 'number') {
        redirectedStatus = statusOrUrl;
        redirectedUrl = optUrl || null;
      } else {
        redirectedStatus = 302;
        redirectedUrl = statusOrUrl;
      }
      return this;
    },
  } as unknown as Response;

  return {
    req,
    res,
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getJsonBody: () => jsonBody as Record<string, any>,
    getRedirect: () => ({ status: redirectedStatus, url: redirectedUrl }),
  };
}

describe('Discord OAuth2 Login Callback Cloud Function (Issue #79)', () => {
  const secretReader = new MockSecretReader('mock-client-secret-abc');
  const oauthClient = new MockDiscordOAuthClient();
  const tokenMinter = new HmacSessionTokenMinter('test-signing-secret', 3600);
  const clientId = 'mock-discord-client-id';
  const defaultRedirectUri = 'http://localhost:5173/auth/callback';

  const handler = createAuthCallbackHandler({
    secretReader,
    oauthClient,
    tokenMinter,
    clientId,
    defaultRedirectUri,
    stateValidator: (state: string) => state.startsWith('valid-csrf-'),
  });

  it('rejects unsupported HTTP methods with 405 Method Not Allowed', async () => {
    const { req, res, getStatusCode, getJsonBody, getHeaders } = createMockHttp({
      method: 'DELETE',
    });

    await handler(req, res);

    assert.equal(getStatusCode(), 405);
    assert.match(getJsonBody().error, /Method Not Allowed/);
    assert.equal(getHeaders()['allow'], 'GET, POST');
  });

  it('rejects missing state parameter with 400 Bad Request', async () => {
    const { req, res, getStatusCode, getJsonBody } = createMockHttp({
      method: 'GET',
      query: { code: 'valid-auth-code-123' },
    });

    await handler(req, res);

    assert.equal(getStatusCode(), 400);
    assert.equal(getJsonBody().code, 'state_missing');
    assert.match(getJsonBody().error, /anti-CSRF/);
  });

  it('rejects state mismatch with 400 Bad Request (Anti-CSRF validation)', async () => {
    const { req, res, getStatusCode, getJsonBody } = createMockHttp({
      method: 'GET',
      query: {
        code: 'valid-auth-code-123',
        state: 'invalid-attacker-csrf-state',
      },
    });

    await handler(req, res);

    assert.equal(getStatusCode(), 400);
    assert.equal(getJsonBody().code, 'state_mismatch');
    assert.match(getJsonBody().error, /CSRF attack detected/);
  });

  it('rejects missing authorization code with 400 Bad Request', async () => {
    const { req, res, getStatusCode, getJsonBody } = createMockHttp({
      method: 'GET',
      query: {
        state: 'valid-csrf-12345',
      },
    });

    await handler(req, res);

    assert.equal(getStatusCode(), 400);
    assert.equal(getJsonBody().code, 'code_missing');
    assert.match(getJsonBody().error, /Missing authorization code/);
  });

  it('rejects bad or expired authorization code with 400 Bad Request', async () => {
    const { req, res, getStatusCode, getJsonBody } = createMockHttp({
      method: 'GET',
      query: {
        code: 'expired-or-bad-code',
        state: 'valid-csrf-session-token-999',
      },
    });

    await handler(req, res);

    assert.equal(getStatusCode(), 400);
    assert.equal(getJsonBody().code, 'bad_code');
    assert.match(getJsonBody().error, /Invalid or expired authorization code/);
  });

  it('handles Secret Manager failure with 500 Internal Server Error', async () => {
    const brokenSecretReader = new MockSecretReader(null);
    const brokenHandler = createAuthCallbackHandler({
      secretReader: brokenSecretReader,
      oauthClient,
      tokenMinter,
      clientId,
      defaultRedirectUri,
    });

    const { req, res, getStatusCode, getJsonBody } = createMockHttp({
      method: 'GET',
      query: {
        code: 'valid-auth-code-123',
        state: 'any-state-no-validator',
      },
    });

    await brokenHandler(req, res);

    assert.equal(getStatusCode(), 500);
    assert.match(getJsonBody().error, /failed to retrieve OAuth client secret/);
  });

  it('handles upstream Discord API failures with 502 Bad Gateway', async () => {
    const errorClient = new MockDiscordOAuthClient();
    errorClient.setSimulateUpstreamError(true);

    const errorOauthHandler = createAuthCallbackHandler({
      secretReader,
      oauthClient: errorClient,
      tokenMinter,
      clientId,
      defaultRedirectUri,
    });

    const { req, res, getStatusCode, getJsonBody } = createMockHttp({
      method: 'GET',
      query: {
        code: 'valid-auth-code-123',
        state: 'any-state-no-validator',
      },
    });

    await errorOauthHandler(req, res);

    assert.equal(getStatusCode(), 502);
    assert.equal(getJsonBody().code, 'upstream_error');
  });

  it('successfully exchanges code and returns JSON session token for API clients', async () => {
    const { req, res, getStatusCode, getJsonBody, getHeaders } = createMockHttp({
      method: 'POST',
      body: {
        code: 'valid-auth-code-123',
        state: 'valid-csrf-client-777',
      },
    });

    await handler(req, res);

    assert.equal(getStatusCode(), 200);
    const body = getJsonBody();
    assert.equal(body.status, 'authenticated');
    assert.equal(body.user.username, 'DiscordArtist');
    assert.equal(body.user.id, 'mock-discord-user-id-alpha');
    assert.equal(body.expiresIn, 3600);
    assert.ok(body.token, 'Must return session token');

    // Verify token structure
    const [headerB64, payloadB64] = body.token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    assert.equal(payload.uid, 'discord:mock-discord-user-id-alpha');
    assert.equal(payload.username, 'DiscordArtist');

    // CRITICAL: Discord access token must be discarded and NEVER stored or exposed
    assert.equal((body as any).access_token, undefined);
    assert.equal((payload as any).access_token, undefined);

    // Verify correlation ID
    assert.ok(getHeaders()['x-correlation-id'], 'Must set X-Correlation-ID header');
  });

  it('propagates incoming X-Correlation-ID header', async () => {
    const customCorrelationId = 'test-trace-999-alpha';
    const { req, res, getStatusCode, getHeaders } = createMockHttp({
      method: 'POST',
      headers: {
        'x-correlation-id': customCorrelationId,
      },
      body: {
        code: 'valid-auth-code-123',
        state: 'valid-csrf-token-555',
      },
    });

    await handler(req, res);

    assert.equal(getStatusCode(), 200);
    assert.equal(getHeaders()['x-correlation-id'], customCorrelationId);
  });

  it('redirects browser GET requests back to frontend with session token in URL', async () => {
    const targetRedirect = 'https://app.example.com/auth/callback';
    const { req, res, getRedirect, getHeaders } = createMockHttp({
      method: 'GET',
      query: {
        code: 'valid-auth-code-123',
        state: 'valid-csrf-session-123',
        redirect_uri: targetRedirect,
      },
    });

    await handler(req, res);

    const redirect = getRedirect();
    assert.equal(redirect.status, 302);
    assert.ok(redirect.url);
    const parsed = new URL(redirect.url);
    assert.equal(parsed.origin, 'https://app.example.com');
    assert.equal(parsed.pathname, '/auth/callback');
    assert.ok(parsed.searchParams.get('token'), 'Must include session token');
    assert.equal(parsed.searchParams.get('username'), 'DiscordArtist');
    assert.equal(getHeaders()['x-correlation-id'].length > 0, true);
  });
});
