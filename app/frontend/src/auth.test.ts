/**
 * Unit tests for Frontend AuthManager (Issue #79, C07 §3.1).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuthManager } from './auth.js';

// Polyfill minimal browser localStorage / sessionStorage and fetch for Node test runner
const mockStorage = new Map<string, string>();
const mockSessionStorage = new Map<string, string>();

(globalThis as any).localStorage = {
  getItem: (k: string) => mockStorage.get(k) || null,
  setItem: (k: string, v: string) => mockStorage.set(k, v),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

(globalThis as any).sessionStorage = {
  getItem: (k: string) => mockSessionStorage.get(k) || null,
  setItem: (k: string, v: string) => mockSessionStorage.set(k, v),
  removeItem: (k: string) => mockSessionStorage.delete(k),
  clear: () => mockSessionStorage.clear(),
};

describe('Frontend AuthManager (Issue #79, C07 §3.1)', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockSessionStorage.clear();
  });

  it('initializes as unauthenticated when storage is empty', () => {
    const auth = new AuthManager();
    assert.equal(auth.isAuthenticated(), false);
    assert.equal(auth.getCurrentUser(), null);
    assert.equal(auth.getSessionToken(), null);
  });

  it('generates unique anti-CSRF state and stores in sessionStorage', () => {
    const auth = new AuthManager();
    const state1 = auth.generateAntiCsrfState();
    assert.ok(state1.startsWith('csrf_'));
    assert.equal(mockSessionStorage.get('teampasx_oauth_state'), state1);

    const state2 = auth.generateAntiCsrfState();
    assert.notEqual(state1, state2);
  });

  it('rejects OAuth code exchange if anti-CSRF state mismatches', async () => {
    const auth = new AuthManager();
    mockSessionStorage.set('teampasx_oauth_state', 'expected-state-123');

    const result = await auth.handleOAuthReturn('valid-code', 'tampered-state-999');
    assert.equal(result.success, false);
    assert.match(result.error || '', /State mismatch/);
    assert.equal(auth.isAuthenticated(), false);
  });

  it('successfully exchanges code with backend and saves profile and token', async () => {
    const auth = new AuthManager();
    const testState = 'csrf-test-state-abc';
    mockSessionStorage.set('teampasx_oauth_state', testState);

    // Mock fetch for backend callback
    (globalThis as any).fetch = async (_url: string, _init: any) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'authenticated',
          token: 'mock-firebase-custom-token-xyz',
          user: {
            id: '123456789012345678',
            username: 'TestDiscordUser',
            avatar: 'avatar_hash_123',
          },
        }),
      };
    };

    let notifiedUser: any = null;
    auth.onAuthStateChanged((u) => {
      notifiedUser = u;
    });

    const result = await auth.handleOAuthReturn('valid-code-777', testState, '/test/callback');

    assert.equal(result.success, true);
    assert.equal(result.user?.username, 'TestDiscordUser');
    assert.equal(result.token, 'mock-firebase-custom-token-xyz');
    assert.equal(auth.isAuthenticated(), true);
    assert.equal(auth.getSessionToken(), 'mock-firebase-custom-token-xyz');
    assert.equal(notifiedUser?.username, 'TestDiscordUser');

    // Anti-CSRF state must be cleared after use
    assert.equal(mockSessionStorage.get('teampasx_oauth_state'), undefined);
  });

  it('clears session on logout', () => {
    const auth = new AuthManager();
    auth.loginMock('DemoUser', '111222333');
    assert.equal(auth.isAuthenticated(), true);

    auth.logout();
    assert.equal(auth.isAuthenticated(), false);
    assert.equal(auth.getCurrentUser(), null);
    assert.equal(auth.getSessionToken(), null);
    assert.equal(mockStorage.get('teampasx_user_profile'), undefined);
  });
});
