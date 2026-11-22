import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRateLimit, DEFAULT_PIXELS_PER_MINUTE } from './ratelimit.js';

test('first draw initializes user with full bucket and allows drawing', () => {
  const now = 1700000000000;
  const result = evaluateRateLimit(null, 'user_123', 1, now);

  assert.equal(result.allowed, true);
  assert.equal(result.effectiveLimit, DEFAULT_PIXELS_PER_MINUTE);
  assert.equal(result.remainingTokens, 19);
  assert.ok(result.updatedDoc);
  assert.equal(result.updatedDoc?.tokens, 19);
  assert.equal(result.updatedDoc?.userId, 'user_123');
});

test('drawing beyond available tokens is rejected with retryAfterSeconds', () => {
  const now = 1700000000000;
  // User has 2 tokens left
  const currentDoc = {
    userId: 'user_123',
    tokens: 2,
    lastRefill: now,
    updatedAt: now,
  };

  // Trying to draw 5 pixels
  const result = evaluateRateLimit(currentDoc, 'user_123', 5, now);
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterSeconds > 0);
  assert.match(result.reason!, /Rate limit exceeded/);
});

test('tokens refill over time', () => {
  const t0 = 1700000000000;
  const doc = {
    userId: 'user_123',
    tokens: 0,
    lastRefill: t0,
    updatedAt: t0,
  };

  // After 30 seconds (half a minute), user should have gained 10 tokens
  const t1 = t0 + 30 * 1000;
  const result = evaluateRateLimit(doc, 'user_123', 5, t1);
  assert.equal(result.allowed, true);
  assert.equal(result.remainingTokens, 5); // 10 refilled - 5 drawn = 5
});

test('respects administrator override', () => {
  const now = 1700000000000;
  const docWithOverride = {
    userId: 'vip_user',
    tokens: 100,
    lastRefill: now,
    overrideLimit: 100,
    updatedAt: now,
  };

  const result = evaluateRateLimit(docWithOverride, 'vip_user', 50, now);
  assert.equal(result.allowed, true);
  assert.equal(result.effectiveLimit, 100);
  assert.equal(result.remainingTokens, 50);
});

test('rejects draw if admin set override to 0', () => {
  const now = 1700000000000;
  const bannedDoc = {
    userId: 'banned_user',
    tokens: 0,
    lastRefill: now,
    overrideLimit: 0,
    updatedAt: now,
  };

  const result = evaluateRateLimit(bannedDoc, 'banned_user', 1, now);
  assert.equal(result.allowed, false);
  assert.match(result.reason!, /Drawing is disabled/);
});
