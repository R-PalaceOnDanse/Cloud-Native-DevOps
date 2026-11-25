/**
 * Firebase App & Firestore Client Initialization.
 * Initializes Firebase JS SDK when configuration is available in environment variables.
 * Fulfills ADR-0008, ADR-0009 and Issue #81.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth, signInWithCustomToken } from 'firebase/auth';

export interface FirebaseInstance {
  app: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
}

let cachedInstance: FirebaseInstance | null = null;

export function getFirebaseConfig(): Record<string, string> | null {
  // Vite environment variables or process.env fallback
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const env = meta.env
    ? meta.env
    : (typeof process !== 'undefined' ? process.env : {});

  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) {
    return null;
  }

  return {
    apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1234567890',
    appId: env.VITE_FIREBASE_APP_ID || '1:1234567890:web:abcdef123456',
  };
}

export function getFirebaseInstance(): FirebaseInstance | null {
  if (cachedInstance) {
    return cachedInstance;
  }

  const config = getFirebaseConfig();
  if (!config) {
    return null;
  }

  try {
    const app = getApps().length > 0 ? getApps()[0]! : initializeApp(config);
    const firestore = getFirestore(app);
    const auth = getAuth(app);

    cachedInstance = { app, firestore, auth };
    return cachedInstance;
  } catch (err) {
    console.warn('Failed to initialize Firebase SDK, falling back to local provider:', err);
    return null;
  }
}

/**
 * Firebase ID token of the signed-in user, refreshed by the SDK. API Gateway verifies it on /draw
 * (issuer securetoken.google.com/<project>), so it is the only credential sent to the API.
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  const user = getFirebaseInstance()?.auth.currentUser;
  return user ? user.getIdToken() : null;
}

/**
 * Authenticates the Firebase client with a custom token minted by the auth-callback function.
 */
export async function authenticateFirebase(customToken: string): Promise<boolean> {
  const instance = getFirebaseInstance();
  if (!instance) return false;

  try {
    await signInWithCustomToken(instance.auth, customToken);
    return true;
  } catch (err) {
    console.error('Firebase custom token authentication failed:', err);
    return false;
  }
}
