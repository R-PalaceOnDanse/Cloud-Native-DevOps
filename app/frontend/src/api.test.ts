import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DrawApiClient } from './api.js';

describe('Draw API Client (Issue #76)', () => {
  it('returns an error if submitted batch is empty', async () => {
    const client = new DrawApiClient();
    const result = await client.submitDraw([]);
    assert.ok('error' in result);
    assert.strictEqual(result.error, 'No pixels to draw.');
  });

  it('handles simulated offline / development fetch fallback smoothly', async () => {
    const client = new DrawApiClient('http://localhost:99999'); // Unreachable port
    const result = await client.submitDraw([{ x: 10, y: 10, color: '#ff0000' }], 'user_token');
    assert.ok('status' in result);
    assert.strictEqual(result.status, 'accepted');
  });
});
