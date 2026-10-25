import type { Session } from "@supabase/supabase-js";

interface SessionResult {
  data: { session: Session | null };
  error: unknown;
}

export function createSocketAuthPayloadProvider(
  getSession: () => Promise<SessionResult>,
  reportError: (message: string) => void = console.error,
): (callback: (payload: { accessToken?: string | null }) => void) => void {
  return (callback) => {
    void getSession().then(({ data, error }) => {
      if (error) {
        throw error;
      }
      callback(data.session ? { accessToken: data.session.access_token } : {});
    }).catch(() => {
      reportError("Unable to load Supabase session for Socket.IO authentication.");
      callback({ accessToken: null });
    });
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
