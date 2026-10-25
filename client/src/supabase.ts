import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

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

export const firebaseConfigurationError =
  hasFirebaseConfig ||
  (!firebaseConfig.apiKey && !firebaseConfig.authDomain && !firebaseConfig.projectId && !firebaseConfig.appId)
    ? null
    : "Set the Firebase client variables (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID) to enable account authentication.";

export const firebaseApp =
  hasFirebaseConfig
    ? getApps().length > 0
      ? getApps()[0]
      : initializeApp(firebaseConfig)
    : null;

export const firebaseClient = firebaseApp ? getAuth(firebaseApp) : null;

export const supabaseClient = firebaseClient;
export const supabaseConfigurationError = firebaseConfigurationError;
