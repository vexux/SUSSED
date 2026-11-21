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

/** Middleware refusals stop Socket.IO's transport reconnection loop. */
export function createHandshakeRetry(
  connect: () => void,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: typeof clearTimeout = clearTimeout,
) {
  const delays = [1000, 2000, 4000, 8000, 16000, 16000];
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function reset() {
    cancel(timer);
    timer = undefined;
    attempts = 0;
  }
  return {
    reset,
    manual() { reset(); connect(); },
    retry() {
      if (timer !== undefined) return true;
      if (attempts >= delays.length) return false;
      timer = schedule(() => { timer = undefined; connect(); }, delays[attempts++]);
      return true;
    },
  };
}

export function handleGuestHandshakeError(
  code: string | undefined,
  storage: GuestSessionStorage | null,
  source: RecoveryCredentialSource,
  retry: () => boolean,
): { code: string; message: string } | null {
  let message: string;
  switch (code) {
    case "INVALID_RECOVERY_CREDENTIAL":
    case "RECOVERY_REPLAYED": {
      const cleared = rejectRecoveryCredential(storage, source);
      if (!cleared.ok) return { code: "RECOVERY_STORAGE_UNAVAILABLE", message: cleared.error! };
      message = source === "pending" ? "Checking the previous guest session credential."
        : "The previous session expired. Connecting as a new guest.";
      break;
    }
    case "PLAYER_ALREADY_CONNECTED":
    case "RECOVERY_IN_PROGRESS":
      message = "Waiting for the previous connection to close.";
      break;
    case "RECOVERY_ACK_TIMEOUT":
      message = "Session confirmation timed out. Reconnecting.";
      break;
    default: return null;
  }
  return retry() ? { code, message } : {
    code: "RECONNECT_EXHAUSTED",
    message: "Automatic reconnect attempts stopped. Check your connection and reconnect.",
  };
}
