import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { resolveAuthFeatureFlag } from "./authFeatureFlag";
import { resolveFirebaseAuthEmulatorConfig } from "./firebaseEmulator";

const authFeatureFlag = resolveAuthFeatureFlag(import.meta.env.VITE_AUTH_ENABLED);
export const authEnabled = authFeatureFlag.enabled;
export const authFeatureFlagError = authFeatureFlag.error;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim(),
};

const hasFirebaseConfig =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.authDomain) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

const firebaseAuthEmulator = authEnabled
  ? resolveFirebaseAuthEmulatorConfig(
      import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_ENABLED,
      import.meta.env.DEV,
      firebaseConfig.projectId,
    )
  : { enabled: false, error: null, url: null };

export const firebaseConfigurationError = authEnabled
  ? firebaseAuthEmulator.error ??
  (hasFirebaseConfig ||
  (!firebaseConfig.apiKey && !firebaseConfig.authDomain && !firebaseConfig.projectId && !firebaseConfig.appId)
    ? null
    : "Set the Firebase client variables (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID) to enable account authentication.")
  : null;

export const firebaseApp =
  authEnabled && hasFirebaseConfig
    ? getApps().length > 0
      ? getApps()[0]
      : initializeApp(firebaseConfig)
    : null;

export const firebaseClient =
  authEnabled && firebaseApp && !firebaseAuthEmulator.error ? getAuth(firebaseApp) : null;

if (firebaseClient && firebaseAuthEmulator.enabled && firebaseAuthEmulator.url) {
  connectAuthEmulator(firebaseClient, firebaseAuthEmulator.url, {
    disableWarnings: true,
  });
}

export const supabaseClient = firebaseClient;
export const supabaseConfigurationError = firebaseConfigurationError;
