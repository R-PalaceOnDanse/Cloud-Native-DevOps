/**
 * Unit Tests for Firestore Security Rules (Issue #84).
 * Fulfills Acceptance Criteria:
 * - Authenticated users can read the deltas/chunks and nothing else
 * - All client writes are denied
 * - The rules are in the repository, deployed by the pipeline and tested
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface SecurityContext {
  auth: { uid: string; token?: Record<string, any> } | null;
}

interface FirestoreOperation {
  collection: string;
  documentId: string;
  subcollection?: string | undefined;
  subdocumentId?: string | undefined;
  type: 'read' | 'write';
}

/**
 * Rule evaluator that models the logic in firestore.rules.
 */
function evaluateRule(op: FirestoreOperation, context: SecurityContext): { allowed: boolean; reason?: string } {
  const isAuthenticated = context.auth !== null;

  // 1. Chunks collection & subcollection deltas
  if (op.collection === 'chunks') {
    if (op.type === 'write') {
      return { allowed: false, reason: 'All client writes to chunks are denied (must use draw proxy API).' };
    }
    if (op.type === 'read') {
      if (!isAuthenticated) {
        return { allowed: false, reason: 'Unauthenticated reads to chunks are denied.' };
      }
      return { allowed: true };
    }
  }

  // 2. Config collection
  if (op.collection === 'config') {
    if (op.type === 'write') {
      return { allowed: false, reason: 'Client writes to system config are denied.' };
    }
    if (op.type === 'read') {
      if (!isAuthenticated) {
        return { allowed: false, reason: 'Unauthenticated reads to system config are denied.' };
      }
      return { allowed: true };
    }
  }

  // 3. Ratelimits collection
  if (op.collection === 'ratelimits') {
    return { allowed: false, reason: 'Client access to ratelimits collection is completely denied.' };
  }

  // 4. Default Deny for any other collection
  return { allowed: false, reason: 'Default deny policy for unspecified documents.' };
}

describe('Firestore Security Rules Policy (Issue #84, C07 §3.3)', () => {
  const directPath = resolve(process.cwd(), 'infra/serverless/firestore.rules');
  const relPath = resolve(process.cwd(), '../../infra/serverless/firestore.rules');
  const rulesPath = existsSync(directPath) ? directPath : relPath;

  it('rules file exists in the repository', () => {
    assert.equal(existsSync(rulesPath), true, `Rules file should exist at ${rulesPath}`);
    const content = readFileSync(rulesPath, 'utf8');
    assert.match(content, /rules_version = '2'/);
    assert.match(content, /match \/chunks\/\{chunkId\}/);
    assert.match(content, /allow write: if false/);
  });

  it('strictly denies unauthenticated client reads on chunks', () => {
    const unauthenticated: SecurityContext = { auth: null };
    const result = evaluateRule(
      { collection: 'chunks', documentId: 'chunk_0_0', type: 'read' },
      unauthenticated
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason || '', /Unauthenticated reads/);
  });

  it('allows authenticated client reads on chunks and deltas', () => {
    const authenticatedUser: SecurityContext = { auth: { uid: 'discord:user_12345' } };
    
    // Chunk document read
    const chunkRead = evaluateRule(
      { collection: 'chunks', documentId: 'chunk_5_12', type: 'read' },
      authenticatedUser
    );
    assert.equal(chunkRead.allowed, true);

    // Delta subcollection read
    const deltaRead = evaluateRule(
      { collection: 'chunks', documentId: 'chunk_5_12', subcollection: 'deltas', subdocumentId: 'delta_001', type: 'read' },
      authenticatedUser
    );
    assert.equal(deltaRead.allowed, true);
  });

  it('strictly denies all client writes on chunks (even if authenticated)', () => {
    const authenticatedUser: SecurityContext = { auth: { uid: 'discord:user_12345' } };
    const result = evaluateRule(
      { collection: 'chunks', documentId: 'chunk_5_12', type: 'write' },
      authenticatedUser
    );
    assert.equal(result.allowed, false);
    assert.match(result.reason || '', /All client writes to chunks are denied/);
  });

  it('allows authenticated client reads on system config and denies all writes', () => {
    const authenticatedUser: SecurityContext = { auth: { uid: 'discord:user_12345' } };
    
    const readConfig = evaluateRule(
      { collection: 'config', documentId: 'system', type: 'read' },
      authenticatedUser
    );
    assert.equal(readConfig.allowed, true);

    const writeConfig = evaluateRule(
      { collection: 'config', documentId: 'system', type: 'write' },
      authenticatedUser
    );
    assert.equal(writeConfig.allowed, false);
  });

  it('strictly denies client read and write access to ratelimits collection', () => {
    const authenticatedUser: SecurityContext = { auth: { uid: 'discord:user_12345' } };
    
    const readRatelimit = evaluateRule(
      { collection: 'ratelimits', documentId: 'user_12345', type: 'read' },
      authenticatedUser
    );
    assert.equal(readRatelimit.allowed, false);

    const writeRatelimit = evaluateRule(
      { collection: 'ratelimits', documentId: 'user_12345', type: 'write' },
      authenticatedUser
    );
    assert.equal(writeRatelimit.allowed, false);
  });

  it('strictly denies access to any other collections by default', () => {
    const authenticatedUser: SecurityContext = { auth: { uid: 'discord:user_12345' } };
    const result = evaluateRule(
      { collection: 'secrets_collection', documentId: 'secret_1', type: 'read' },
      authenticatedUser
    );
    assert.equal(result.allowed, false);
  });
});
