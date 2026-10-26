import {
  createUserWithEmailAndPassword,
  confirmPasswordReset,
  GoogleAuthProvider,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  verifyPasswordResetCode,
  type Auth,
  type User,
} from "firebase/auth";

export type AuthFormMode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "recovery";

export interface AuthResult {
  user: { id: string; email: string | null } | null;
  requiresEmailVerification?: boolean;
}

export interface RestoredAuthSession {
  user: { id: string; email: string | null } | null;
  accessToken: string | null;
  requiresEmailVerification: boolean;
}

export interface AuthService {
  restoreSession(): Promise<RestoredAuthSession>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  resendVerification(email: string): Promise<"sent" | "already-verified">;
  requestPasswordRecovery(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  verifyPasswordResetCode(code: string): Promise<string>;
  confirmPasswordReset(code: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
}

type FirebaseAuthApi = Pick<
  typeof import("firebase/auth"),
  | "createUserWithEmailAndPassword"
  | "confirmPasswordReset"
  | "GoogleAuthProvider"
  | "reload"
  | "sendEmailVerification"
  | "sendPasswordResetEmail"
  | "signInWithEmailAndPassword"
  | "signInWithPopup"
  | "signOut"
  | "updatePassword"
  | "verifyPasswordResetCode"
>;

const defaultFirebaseAuthApi: FirebaseAuthApi = {
  createUserWithEmailAndPassword,
  confirmPasswordReset,
  GoogleAuthProvider,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  verifyPasswordResetCode,
};

export function getAuthRedirectUrl(
  configuredRedirectUrl: string | undefined,
  currentOrigin: string,
): string {
  const redirectUrl = configuredRedirectUrl?.trim();
  return redirectUrl || currentOrigin;
}

function getErrorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code.toLowerCase()
    : "";
}

export function getAuthErrorMessage(error: unknown): string {
  const code = getErrorCode(error);
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  const detail = `${code} ${message}`;

  if (
    detail.includes("invalid-login-credentials") ||
    detail.includes("wrong-password") ||
    detail.includes("user-not-found")
  ) {
    return "That email and password combination was not recognized.";
  }
  if (detail.includes("email-not-verified") || detail.includes("email not confirmed")) {
    return "Verify your email before signing in. You can request a new verification email below.";
  }
  if (detail.includes("email-already-in-use") || detail.includes("already registered")) {
    return "An account already exists for this email. Try signing in instead.";
  }
  if (detail.includes("weak-password") || detail.includes("password-too-short")) {
    return "Choose a stronger password with at least 8 characters.";
  }
  if (detail.includes("too-many-requests") || detail.includes("rate limit")) {
    return "Firebase has temporarily limited email requests. Wait a little while, then try again.";
  }
  if (detail.includes("network-request-failed") || detail.includes("network")) {
    return "Could not reach Firebase. Check your internet connection and try again.";
  }
  if (
    detail.includes("unauthorized-continue-uri") ||
    detail.includes("invalid-continue-uri")
  ) {
    return "Firebase rejected the verification link destination. Add this app's domain to Firebase Authentication's authorized domains.";
  }
  if (detail.includes("operation-not-allowed")) {
    return "Email/password authentication is disabled. Enable it in Firebase Authentication sign-in settings.";
  }
  if (
    detail.includes("expired-action-code") ||
    detail.includes("invalid-action-code") ||
    detail.includes("expired") ||
    detail.includes("otp")
  ) {
    return "This authentication link is invalid or has expired. Request a new link and try again.";
  }
  if (detail.includes("requires-recent-login")) {
    return "For security, sign in again before changing your password.";
  }
  if (detail.includes("popup-blocked")) {
    return "The Google sign-in popup was blocked. Allow popups for this site and try again.";
  }
  if (detail.includes("popup-closed-by-user")) {
    return "Google sign-in was cancelled.";
  }
  if (detail.includes("provider-already-linked") || detail.includes("account-exists-with-different-credential")) {
    return "This email is already associated with another sign-in method. Sign in using that method.";
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
  if (password.length < 8) {
    throw new Error("Choose a password with at least 8 characters.");
  }
}

function isEmailPasswordUser(user: User): boolean {
  return user.providerData.some(({ providerId }) => providerId === "password");
}

function toAuthUser(user: User | null): AuthResult["user"] {
  return user ? { id: user.uid, email: user.email } : null;
}

export function createAuthService(
  client: Auth,
  redirectUrl: string,
  api: FirebaseAuthApi = defaultFirebaseAuthApi,
): AuthService {
  return {
    async restoreSession() {
      await client.authStateReady();
      const user = client.currentUser;
      if (user) {
        await api.reload(user);
      }
      return {
        user: toAuthUser(user),
        accessToken: user ? await user.getIdToken() : null,
        requiresEmailVerification:
          Boolean(user && isEmailPasswordUser(user) && !user.emailVerified),
      };
    },

    async signIn(email, password) {
      validateCredentials(email, password);
      try {
        const { user } = await api.signInWithEmailAndPassword(
          client,
          email.trim(),
          password,
        );
        await api.reload(user);
        return {
          user: toAuthUser(user),
          requiresEmailVerification:
            isEmailPasswordUser(user) && !user.emailVerified,
        };
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },

    async signUp(email, password) {
      validateCredentials(email, password);
      try {
        const { user } = await api.createUserWithEmailAndPassword(
          client,
          email.trim(),
          password,
        );
        await api.sendEmailVerification(user, { url: redirectUrl });
        return {
          user: toAuthUser(user),
          requiresEmailVerification: true,
        };
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },

    async signOut() {
      try {
        await api.signOut(client);
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },

    async resendVerification(email) {
      validateCredentials(email);
      const user = client.currentUser;
      if (!user) {
        throw new Error("No signed-in account is available. Sign in with email and password before resending verification.");
      }
      if (!isEmailPasswordUser(user)) {
        throw new Error("This account does not use email/password sign-in, so it does not need a verification email.");
      }
      if (
        !user.email ||
        user.email.trim().toLowerCase() !== email.trim().toLowerCase()
      ) {
        throw new Error("The entered email does not match the signed-in account. Use that account's email to resend verification.");
      }

      try {
        await api.reload(user);
        if (user.emailVerified) {
          return "already-verified";
        }
        await api.sendEmailVerification(user, { url: redirectUrl });
        return "sent";
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },

    async requestPasswordRecovery(email) {
      validateCredentials(email);
      try {
        await api.sendPasswordResetEmail(client, email.trim(), {
          url: redirectUrl,
        });
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },

    async updatePassword(password) {
      validatePassword(password);
      const user = client.currentUser;
      if (!user) {
        throw new Error("Sign in again before changing your password.");
      }
      try {
        await api.updatePassword(user, password);
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },

    async verifyPasswordResetCode(code) {
      if (!code.trim()) {
        throw new Error("This password recovery link is invalid or expired. Request a new recovery email.");
      }
      try {
        return await api.verifyPasswordResetCode(client, code);
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },

    async confirmPasswordReset(code, password) {
      if (!code.trim()) {
        throw new Error("This password recovery link is invalid or expired. Request a new recovery email.");
      }
      validatePassword(password);
      try {
        await api.confirmPasswordReset(client, code, password);
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },

    async signInWithGoogle() {
      try {
        const provider = new api.GoogleAuthProvider();
        await api.signInWithPopup(client, provider);
      } catch (error) {
        if (getErrorCode(error) === "auth/operation-not-allowed") {
          throw new Error(
            "Google sign-in is not enabled. Enable the Google provider in Firebase Authentication.",
          );
        }
        throw new Error(getAuthErrorMessage(error));
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
  const isRecoveryContext =
    mode === "resetPassword" || parameters.get("type") === "recovery";
  if (
    errorCode === "otp_expired" ||
    (isRecoveryContext && (
      errorCode === "invalid_action_code" ||
      errorCode === "expired_action_code" ||
      errorCode === "access_denied"
    )) ||
    (mode === "resetPassword" && !parameters.get("oobCode")) ||
    (parameters.get("error") && isRecoveryContext)
  ) {
    return "This password recovery link is invalid or has expired. Request a new recovery email.";
  }
  return null;
}

export function getPasswordResetCode(search: string, hash: string): string | null {
  const parameters = new URLSearchParams(search.replace(/^\?/u, ""));
  for (const [key, value] of new URLSearchParams(hash.replace(/^#/u, ""))) {
    parameters.set(key, value);
  }
  return parameters.get("mode") === "resetPassword"
    ? parameters.get("oobCode")
    : null;
}
