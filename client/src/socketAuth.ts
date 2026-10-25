import { reload, type Auth, type User } from "firebase/auth";

interface SessionResult {
  data?: { session?: { access_token?: string | null } | null; user?: { id?: string } | null };
  accessToken?: string | null;
  error?: unknown;
}

function extractAccessToken(result: unknown): string | null {
  if (typeof result === "string") {
    return result || null;
  }
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as SessionResult;
  if (typeof record.accessToken === "string") {
    return record.accessToken || null;
  }
  if (record.data && typeof record.data === "object") {
    const session = record.data.session;
    if (session && typeof session.access_token === "string") {
      return session.access_token || null;
    }
    if (record.data.user && typeof (record.data.user as { id?: string }).id === "string") {
      return null;
    }
  }
  return null;
}

export function createSocketAuthPayloadProvider(
  getSession: () => Promise<unknown>,
  reportError: (message: string) => void = console.error,
): (callback: (payload: { accessToken?: string | null }) => void) => void {
  return (callback) => {
    void Promise.resolve()
      .then(() => getSession())
      .then((result) => {
        if (result && typeof result === "object" && "error" in result && result.error) {
          throw result.error;
        }
        const token = extractAccessToken(result);
        callback(token ? { accessToken: token } : {});
      })
      .catch(() => {
        reportError("Unable to load the current auth session for Socket.IO authentication.");
        callback({ accessToken: null });
      });
  };
}

export async function getFirebaseSocketAuthPayload(
  auth: Auth | null,
  reloadUser: typeof reload = reload,
): Promise<{ accessToken?: string }> {
  if (!auth) {
    return {};
  }

  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    return {};
  }

  const isEmailPasswordUser = user.providerData.some(
    ({ providerId }) => providerId === "password",
  );
  if (isEmailPasswordUser && !user.emailVerified) {
    await reloadUser(user);
    if (!user.emailVerified) {
      return {};
    }
  }

  const accessToken = await user.getIdToken();
  if (!accessToken) {
    throw new Error("Firebase returned an empty ID token.");
  }
  return { accessToken };
}

export interface SocketTokenRefreshLifecycle {
  disconnect(): unknown;
  connect(): unknown;
}

export function createSocketTokenRefreshRetry(
  socket: SocketTokenRefreshLifecycle,
  getCurrentUser: () => Pick<User, "getIdToken"> | null,
): { refreshAndReconnect(): Promise<boolean>; reset(): void } {
  let attemptedRefresh = false;

  return {
    async refreshAndReconnect() {
      if (attemptedRefresh) {
        return false;
      }
      attemptedRefresh = true;
      const user = getCurrentUser();
      if (!user) {
        return false;
      }

      try {
        await user.getIdToken(true);
      } catch {
        return false;
      }
      socket.disconnect();
      socket.connect();
      return true;
    },

    reset() {
      attemptedRefresh = false;
    },
  };
}

export interface SocketSession {
  user: { id: string };
}

export interface SocketSessionLifecycle {
  disconnect(): unknown;
  connect(): unknown;
}

export function createSocketSessionChangeHandler(
  socket: SocketSessionLifecycle,
): (event: string, session: SocketSession | null) => void {
  let currentUserId: string | null | undefined;

  return (event, session) => {
    const nextUserId = session?.user.id ?? null;
    if (event === "INITIAL_SESSION") {
      currentUserId = nextUserId;
      return;
    }

    const identityChanged = currentUserId !== undefined && currentUserId !== nextUserId;
    currentUserId = nextUserId;
    if (!identityChanged || event === "TOKEN_REFRESHED") {
      return;
    }

    queueMicrotask(() => {
      socket.disconnect();
      socket.connect();
    });
  };
}
