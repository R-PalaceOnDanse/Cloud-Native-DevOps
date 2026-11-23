/**
 * Production Firestore Real-time Subscription Provider.
 * Connects directly to Cloud Firestore using the Firebase Web SDK.
 * Fulfills Issue #81, C07 §3.3 and ADR-0008 (Zero Polling, purely event-driven).
 */

import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import type {
  RealtimeSubscriptionProvider,
  ChunkUpdateCallback,
  SystemStateCallback,
  UnsubscribeCallback,
  ChunkPayload,
  RemotePixel,
} from './realtime.js';
import { parseChunkId } from './realtime.js';
import { getFirebaseInstance } from './firebase.js';
import { MockRealtimeProvider } from './realtime.js';

export class FirestoreRealtimeProvider implements RealtimeSubscriptionProvider {
  private readonly firestore: Firestore;
  private readonly auth?: Auth | undefined;

  constructor(firestore: Firestore, auth?: Auth | undefined) {
    this.firestore = firestore;
    this.auth = auth;
  }

  public subscribe(chunkId: string, onUpdate: ChunkUpdateCallback): UnsubscribeCallback {
    const chunkRef = doc(this.firestore, 'chunks', chunkId);

    const unsubscribe = onSnapshot(
      chunkRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          return;
        }

        const data = snapshot.data();
        const coords = parseChunkId(chunkId);
        const chunkX = typeof data.chunkX === 'number' ? data.chunkX : (coords?.cx ?? 0);
        const chunkY = typeof data.chunkY === 'number' ? data.chunkY : (coords?.cy ?? 0);
        const rawPixels = (data.pixels || {}) as Record<string, RemotePixel>;
        const updatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : Date.now();

        const payload: ChunkPayload = {
          chunkId,
          chunkX,
          chunkY,
          pixels: rawPixels,
          updatedAt,
        };

        onUpdate(payload);
      },
      (error) => {
        console.warn(`Firestore listener error on chunk ${chunkId}:`, error);
      }
    );

    return unsubscribe;
  }

  public subscribeSystemState(onUpdate: SystemStateCallback): UnsubscribeCallback {
    const configRef = doc(this.firestore, 'config', 'system');

    const unsubscribe = onSnapshot(
      configRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          onUpdate({ paused: false });
          return;
        }

        const data = snapshot.data();
        onUpdate({
          paused: Boolean(data.paused),
          lastClearedAt: typeof data.lastClearedAt === 'number' ? data.lastClearedAt : null,
          updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
        });
      },
      (error) => {
        console.warn('Firestore listener error on config/system:', error);
      }
    );

    return unsubscribe;
  }
}

/**
 * Factory function creating the appropriate provider:
 * - In production / cloud with Firebase config: uses native FirestoreRealtimeProvider.
 * - In local development / offline / test: uses MockRealtimeProvider.
 */
export function createRealtimeProvider(): RealtimeSubscriptionProvider {
  const firebase = getFirebaseInstance();
  if (firebase) {
    return new FirestoreRealtimeProvider(firebase.firestore, firebase.auth);
  }
  return new MockRealtimeProvider();
}
