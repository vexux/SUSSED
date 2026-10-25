export const FIREBASE_AUTH_EMULATOR_PROJECT_ID = "demo-sussed-167f0";
export const FIREBASE_AUTH_EMULATOR_URL = "http://127.0.0.1:9099";

export interface FirebaseAuthEmulatorConfig {
  enabled: boolean;
  error: string | null;
  url: string | null;
}

export function resolveFirebaseAuthEmulatorConfig(
  enabledValue: string | undefined,
  isDevelopment: boolean,
  projectId: string | undefined,
): FirebaseAuthEmulatorConfig {
  const setting = enabledValue?.trim().toLowerCase();
  if (setting && setting !== "true" && setting !== "false") {
    return {
      enabled: false,
      error: "VITE_FIREBASE_AUTH_EMULATOR_ENABLED must be set to true or false.",
      url: null,
    };
  }

  if (setting !== "true") {
    return { enabled: false, error: null, url: null };
  }

  if (!isDevelopment) {
    return {
      enabled: false,
      error: "Firebase Auth Emulator mode is available only in a development build.",
      url: null,
    };
  }

  if (projectId?.trim() !== FIREBASE_AUTH_EMULATOR_PROJECT_ID) {
    return {
      enabled: false,
      error: `Set VITE_FIREBASE_PROJECT_ID=${FIREBASE_AUTH_EMULATOR_PROJECT_ID} when Firebase Auth Emulator mode is enabled.`,
      url: null,
    };
  }

  return {
    enabled: true,
    error: null,
    url: FIREBASE_AUTH_EMULATOR_URL,
  };
}
