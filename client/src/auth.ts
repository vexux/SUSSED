export type AuthFormMode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "recovery";

export interface AuthResult {
  user: { id?: string; email?: string | null } | null;
  requiresEmailVerification?: boolean;
}

export interface RestoredAuthSession {
  user: { id?: string; email?: string | null } | null;
  accessToken: string | null;
}

export interface AuthService {
  restoreSession(): Promise<RestoredAuthSession>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  resendVerification(email: string): Promise<void>;
  requestPasswordRecovery(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
}

export function getAuthRedirectUrl(
  configuredRedirectUrl: string | undefined,
  currentOrigin: string,
): string {
  const redirectUrl = configuredRedirectUrl?.trim();
  return redirectUrl || currentOrigin;
}

function getErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }
  if ("message" in error && typeof error.message === "string") {
    return error.message.toLowerCase();
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code.toLowerCase();
  }
  return "";
}

export function getAuthErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);

  if (
    message.includes("invalid login credentials") ||
    message.includes("wrong-password") ||
    message.includes("user-not-found")
  ) {
    return "That email and password combination was not recognized.";
  }
  if (
    message.includes("email not confirmed") ||
    message.includes("email_not_confirmed") ||
    message.includes("email-not-verified")
  ) {
    return "Verify your email before signing in. You can request a new verification email below.";
  }
  if (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("email-already-in-use")
  ) {
    return "An account already exists for this email. Try signing in instead.";
  }
  if (
    message.includes("password") &&
    (message.includes("weak") || message.includes("short") || message.includes("too-short"))
  ) {
    return "Choose a stronger password with at least 8 characters.";
  }
  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("too-many-requests")) {
    return "Too many attempts. Wait a little while, then try again.";
  }
  if (
    message.includes("provider is not enabled") ||
    message.includes("unsupported provider") ||
    message.includes("provider_disabled") ||
    message.includes("popup-closed-by-user") ||
    message.includes("auth/popup-closed-by-user")
  ) {
    return "Google sign-in is not enabled for this project or was cancelled. Configure the Google provider and try again.";
  }
  if (
    message.includes("expired") ||
    message.includes("invalid") ||
    message.includes("otp") ||
    message.includes("invalid-action-code") ||
    message.includes("expired-action-code")
  ) {
    return "This authentication link is invalid or has expired. Request a new link and try again.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "Could not reach the authentication service. Check your connection and try again.";
  }
  return "Authentication could not be completed. Check your details and Firebase configuration, then try again.";
}

function validateCredentials(email: string, password?: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())) {
    throw new Error("Enter a valid email address.");
  }
  if (password !== undefined) validatePassword(password);
}

function validatePassword(password: string): void {
  if (password.length < 8) throw new Error("Choose a password with at least 8 characters.");
}

function resolveFirebaseUserValue(user: unknown): { id?: string; email?: string | null } | null {
  if (!user || typeof user !== "object") return null;
  const record = user as { uid?: string; id?: string; email?: string | null };
  return {
    id: record.uid ?? record.id,
    email: record.email ?? null,
  };
}

async function getCurrentFirebaseSession(client: any): Promise<RestoredAuthSession> {
  const auth = client?.auth ?? client;
  if (auth && typeof auth.currentUser !== "undefined" && auth.currentUser !== null) {
    const user = auth.currentUser;
    const accessToken = typeof user.getIdToken === "function"
      ? await user.getIdToken().catch(() => null)
      : null;
    return { user: resolveFirebaseUserValue(user), accessToken };
  }

  if (auth && typeof auth.getSession === "function") {
    const { data, error } = await auth.getSession();
    if (error) throw new Error(getAuthErrorMessage(error));
    return {
      user: resolveFirebaseUserValue(data?.session?.user ?? data?.user ?? null),
      accessToken: data?.session?.access_token ?? null,
    };
  }

  return { user: null, accessToken: null };
}

export function createAuthService(
  client: any,
  redirectUrl: string,
): AuthService {
  const auth = client?.auth ?? client;
  const supportsFirebase = Boolean(auth && typeof auth === "object" && "currentUser" in auth);

  return {
    async restoreSession() {
      if (supportsFirebase) {
        return getCurrentFirebaseSession(client);
      }
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error(getAuthErrorMessage(error));
      return {
        user: data.session?.user ?? null,
        accessToken: data.session?.access_token ?? null,
      };
    },

    async signIn(email, password) {
      validateCredentials(email, password);
      if (supportsFirebase) {
        const { signInWithEmailAndPassword } = await import("firebase/auth");
        const result = await signInWithEmailAndPassword(auth, email.trim(), password).catch((error: unknown) => {
          throw new Error(getAuthErrorMessage(error));
        });
        return {
          user: resolveFirebaseUserValue(result?.user ?? null),
          requiresEmailVerification: false,
        };
      }
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(getAuthErrorMessage(error));
      return { user: data.user, requiresEmailVerification: false };
    },

    async signUp(email, password) {
      validateCredentials(email, password);
      if (supportsFirebase) {
        const { createUserWithEmailAndPassword } = await import("firebase/auth");
        const result = await createUserWithEmailAndPassword(auth, email.trim(), password).catch((error: unknown) => {
          throw new Error(getAuthErrorMessage(error));
        });
        const user = result?.user ?? null;
        const firebaseUser = user as { sendEmailVerification?: (settings?: { url?: string }) => Promise<void> } | null;
        if (firebaseUser && typeof firebaseUser.sendEmailVerification === "function") {
          await firebaseUser.sendEmailVerification({ url: redirectUrl }).catch(() => undefined);
        }
        return {
          user: resolveFirebaseUserValue(user),
          requiresEmailVerification: true,
        };
      }
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: redirectUrl },
      });
      if (error) throw new Error(getAuthErrorMessage(error));
      return {
        user: data.user,
        requiresEmailVerification: data.session === null,
      };
    },

    async signOut() {
      if (supportsFirebase) {
        await auth.signOut().catch((error: unknown) => {
          throw new Error(getAuthErrorMessage(error));
        });
        return;
      }
      const { error } = await client.auth.signOut();
      if (error) throw new Error(getAuthErrorMessage(error));
    },

    async resendVerification(email) {
      validateCredentials(email);
      if (supportsFirebase) {
        const user = auth.currentUser as { sendEmailVerification?: (settings?: { url?: string }) => Promise<void> } | null;
        if (user && typeof user.sendEmailVerification === "function") {
          await user.sendEmailVerification({ url: redirectUrl }).catch((error: unknown) => {
            throw new Error(getAuthErrorMessage(error));
          });
          return;
        }
      }
      const { error } = await client.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: redirectUrl },
      });
      if (error) throw new Error(getAuthErrorMessage(error));
    },

    async requestPasswordRecovery(email) {
      validateCredentials(email);
      if (supportsFirebase) {
        const { sendPasswordResetEmail } = await import("firebase/auth");
        await sendPasswordResetEmail(auth, email.trim(), { url: redirectUrl }).catch((error: unknown) => {
          throw new Error(getAuthErrorMessage(error));
        });
        return;
      }
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl,
      });
      if (error) throw new Error(getAuthErrorMessage(error));
    },

    async updatePassword(password) {
      validatePassword(password);
      if (supportsFirebase && auth.currentUser && typeof auth.currentUser.updatePassword === "function") {
        await auth.currentUser.updatePassword(password).catch((error: unknown) => {
          throw new Error(getAuthErrorMessage(error));
        });
        return;
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) throw new Error(getAuthErrorMessage(error));
    },

    async signInWithGoogle() {
      if (supportsFirebase) {
        const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider).catch((error: unknown) => {
          throw new Error(getAuthErrorMessage(error));
        });
        if (!result?.user) {
          throw new Error("Google sign-in could not start. Confirm the Google provider is configured and enabled.");
        }
        return;
      }
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl },
      });
      if (error) throw new Error(getAuthErrorMessage(error));
      if (!data.url) {
        throw new Error(
          "Google sign-in could not start. Confirm the Google provider is configured in Firebase.",
        );
      }
    },
  };
}

export function getRecoveryLinkError(hash: string, search = ""): string | null {
  const parameters = new URLSearchParams(search.replace(/^\?/u, ""));
  for (const [key, value] of new URLSearchParams(hash.replace(/^#/u, ""))) {
    parameters.set(key, value);
  }
  const errorCode = parameters.get("error_code") ?? parameters.get("error");
  const mode = parameters.get("mode");
  if (
    errorCode === "otp_expired" ||
    errorCode === "invalid_action_code" ||
    errorCode === "expired_action_code" ||
    errorCode === "access_denied" ||
    (mode === "resetPassword" && !parameters.get("oobCode")) ||
    (parameters.get("error") && parameters.get("type") === "recovery")
  ) {
    return "This password recovery link is invalid or has expired. Request a new recovery email.";
  }
  return null;
}
