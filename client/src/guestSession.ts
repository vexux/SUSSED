export const GUEST_RECOVERY_STORAGE_KEY = "sussed:guest-recovery:v1";
export const PENDING_RECOVERY_STORAGE_KEY = "sussed:guest-recovery:v1:pending";

export type RecoveryCredentialSource = "pending" | "current" | null;
export type GuestSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface RecoveryCredentialRead {
  credential: string | null;
  source: RecoveryCredentialSource;
  error: string | null;
}

export interface GuestSocketAuthPayload {
  authPayload: Record<string, unknown>;
  source: RecoveryCredentialSource;
  error: string | null;
}

export interface GuestSessionStorageResult {
  ok: boolean;
  error: string | null;
}

export function getBrowserSessionStorage(): GuestSessionStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readRecoveryCredential(
  storage: GuestSessionStorage | null,
): RecoveryCredentialRead {
  if (!storage) {
    return {
      credential: null,
      source: null,
      error: "Browser session storage is unavailable. Guest session recovery cannot be secured.",
    };
  }
  try {
    const pending = storage.getItem(PENDING_RECOVERY_STORAGE_KEY);
    if (pending) return { credential: pending, source: "pending", error: null };
    const current = storage.getItem(GUEST_RECOVERY_STORAGE_KEY);
    return { credential: current || null, source: current ? "current" : null, error: null };
  } catch {
    return {
      credential: null,
      source: null,
      error: "Browser session storage could not be read. Guest session recovery cannot be secured.",
    };
  }
}

export function attachRecoveryCredential(
  authPayload: Record<string, unknown>,
  storage: GuestSessionStorage | null,
): GuestSocketAuthPayload {
  const recovery = readRecoveryCredential(storage);
  return {
    authPayload: {
      ...authPayload,
      ...(recovery.credential ? { recoveryCredential: recovery.credential } : {}),
    },
    source: recovery.source,
    error: recovery.error,
  };
}

export function stageRecoveryCredential(
  storage: GuestSessionStorage | null,
  credential: string,
): GuestSessionStorageResult {
  if (!storage) {
    return {
      ok: false,
      error: "Browser session storage is unavailable. Guest session recovery cannot be secured.",
    };
  }
  if (!/^[0-9a-f]{64}$/u.test(credential)) {
    return {
      ok: false,
      error: "The server returned an invalid guest recovery credential.",
    };
  }
  try {
    storage.setItem(PENDING_RECOVERY_STORAGE_KEY, credential);
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: "Guest recovery could not be saved in this tab. Enable session storage and reconnect.",
    };
  }
}

export function promoteRecoveryCredential(
  storage: GuestSessionStorage | null,
): GuestSessionStorageResult {
  if (!storage) {
    return {
      ok: false,
      error: "Browser session storage is unavailable. Guest session recovery cannot be secured.",
    };
  }
  try {
    const pending = storage.getItem(PENDING_RECOVERY_STORAGE_KEY);
    if (!pending) {
      return {
        ok: false,
        error: "The pending guest recovery credential is missing.",
      };
    }
    storage.setItem(GUEST_RECOVERY_STORAGE_KEY, pending);
    storage.removeItem(PENDING_RECOVERY_STORAGE_KEY);
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: "The active guest credential is stored, but its rotation could not be finalized in this tab.",
    };
  }
}

export function rejectRecoveryCredential(
  storage: GuestSessionStorage | null,
  source: RecoveryCredentialSource,
): GuestSessionStorageResult {
  if (!storage) {
    return {
      ok: false,
      error: "Browser session storage is unavailable. Guest session recovery cannot be updated.",
    };
  }
  if (!source) return { ok: true, error: null };
  try {
    storage.removeItem(
      source === "pending"
        ? PENDING_RECOVERY_STORAGE_KEY
        : GUEST_RECOVERY_STORAGE_KEY,
    );
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: "The invalid guest recovery credential could not be cleared from this tab.",
    };
  }
}
