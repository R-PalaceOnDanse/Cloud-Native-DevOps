import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StructuredLogger, sanitizeLogData } from './logger.js';

describe('StructuredLogger (Issue #89)', () => {
  it('formats structured log entry matching docs/events.md fields', () => {
    let capturedLine = '';
    const logger = new StructuredLogger({
      functionName: 'draw-worker',
      defaultContext: { correlationId: 'corr-1234-uuid', eventId: 'evt-5678' },
      outputStream: (line) => { capturedLine = line; },
    });

    const entry = logger.info('Pixel draw processed successfully', {
      pixelCount: 5,
      chunkId: 'chunk_10_20',
    });

    assert.equal(entry.severity, 'INFO');
    assert.equal(entry.message, 'Pixel draw processed successfully');
    assert.equal(entry.functionName, 'draw-worker');
    assert.equal(entry.correlationId, 'corr-1234-uuid');
    assert.equal(entry.eventId, 'evt-5678');
    assert.equal(entry.pixelCount, 5);
    assert.equal(entry.chunkId, 'chunk_10_20');
    assert.ok(entry.timestamp);

    const parsed = JSON.parse(capturedLine);
    assert.equal(parsed.correlationId, 'corr-1234-uuid');
    assert.equal(parsed.severity, 'INFO');
  });

  it('chains context with withContext', () => {
    let capturedLine = '';
    const rootLogger = new StructuredLogger({
      functionName: 'web-draw-proxy',
      outputStream: (line) => { capturedLine = line; },
    });

    const requestLogger = rootLogger.withContext({
      correlationId: 'req-abc-999',
      userId: 'user-42',
    });

    requestLogger.warn('Rate limit approaching threshold', { remainingTokens: 2 });
    const parsed = JSON.parse(capturedLine);

    assert.equal(parsed.functionName, 'web-draw-proxy');
    assert.equal(parsed.correlationId, 'req-abc-999');
    assert.equal(parsed.userId, 'user-42');
    assert.equal(parsed.severity, 'WARNING');
    assert.equal(parsed.remainingTokens, 2);
  });

  it('redacts sensitive tokens, credentials, and authorization headers', () => {
    let capturedLine = '';
    const logger = new StructuredLogger({
      functionName: 'auth-callback',
      outputStream: (line) => { capturedLine = line; },
    });

    logger.info('OAuth exchange completed', {
      discordCode: 'secret_oauth_code_12345',
      botToken: 'Bot MTIzNDU2Nzg5.secret.token',
      accessToken: 'discord_access_token_xyz',
      clientSecret: 'super_secret_discord_app_key',
      authHeader: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      safeField: 'visible_data_public',
      nested: {
        token: 'nested_token_value',
        password: 'nested_password_value',
        subItem: {
          signature: 'ed25519_sig_hex_123456789',
        },
      },
    });

    const parsed = JSON.parse(capturedLine);

    assert.equal(parsed.safeField, 'visible_data_public');
    assert.equal(parsed.discordCode, '[REDACTED]');
    assert.equal(parsed.botToken, '[REDACTED]');
    assert.equal(parsed.accessToken, '[REDACTED]');
    assert.equal(parsed.clientSecret, '[REDACTED]');
    assert.equal(parsed.authHeader, '[REDACTED]');
    assert.equal(parsed.nested.token, '[REDACTED]');
    assert.equal(parsed.nested.password, '[REDACTED]');
    assert.equal(parsed.nested.subItem.signature, '[REDACTED]');
  });

  it('sanitizeLogData handles primitives, null, and arrays safely', () => {
    assert.equal(sanitizeLogData(null), null);
    assert.equal(sanitizeLogData(undefined), undefined);
    assert.equal(sanitizeLogData(42), 42);
    assert.equal(sanitizeLogData(true), true);

    const arrayInput = [
      { name: 'pixel', color: '#ff0000' },
      { token: 'secret-array-token', x: 10 },
    ];
    const sanitizedArray = sanitizeLogData(arrayInput);
    assert.equal(sanitizedArray[0].name, 'pixel');
    assert.equal(sanitizedArray[1].token, '[REDACTED]');
    assert.equal(sanitizedArray[1].x, 10);
  });
});
