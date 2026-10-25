import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AuthFormMode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "recovery";

export interface AuthResult {
  user: User | null;
  requiresEmailVerification?: boolean;
}

export interface RestoredAuthSession {
  user: User | null;
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

export function getAuthErrorMessage(error: unknown): string {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";

  if (message.includes("invalid login credentials")) {
    return "That email and password combination was not recognized.";
  }
  if (message.includes("email not confirmed") || message.includes("email_not_confirmed")) {
    return "Verify your email before signing in. You can request a new verification email below.";
  }
  if (message.includes("already registered") || message.includes("already been registered")) {
    return "An account already exists for this email. Try signing in instead.";
  }
  if (message.includes("password") && (message.includes("weak") || message.includes("short"))) {
    return "Choose a stronger password with at least 8 characters.";
  }
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return "Too many attempts. Wait a little while, then try again.";
  }
  if (
    message.includes("provider is not enabled") ||
    message.includes("unsupported provider") ||
    message.includes("provider_disabled")
  ) {
    return "Google sign-in is not enabled for this Supabase project. Configure the Google provider in Supabase, then try again.";
  }
  if (
    message.includes("expired") ||
    message.includes("invalid") ||
    message.includes("otp")
  ) {
    return "This authentication link is invalid or has expired. Request a new link and try again.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "Could not reach the authentication service. Check your connection and try again.";
  }
  return "Authentication could not be completed. Check your details and Supabase configuration, then try again.";
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

export function createAuthService(
  client: SupabaseClient,
  redirectUrl: string,
): AuthService {
  return {
    async restoreSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error(getAuthErrorMessage(error));
      return {
        user: data.session?.user ?? null,
        accessToken: data.session?.access_token ?? null,
      };
    },

    async signIn(email, password) {
      validateCredentials(email, password);
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(getAuthErrorMessage(error));
      return { user: data.user, requiresEmailVerification: false };
    },

    async signUp(email, password) {
      validateCredentials(email, password);
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
      const { error } = await client.auth.signOut();
      if (error) throw new Error(getAuthErrorMessage(error));
    },

    async resendVerification(email) {
      validateCredentials(email);
      const { error } = await client.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: redirectUrl },
      });
      if (error) throw new Error(getAuthErrorMessage(error));
    },

    async requestPasswordRecovery(email) {
      validateCredentials(email);
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl,
      });
      if (error) throw new Error(getAuthErrorMessage(error));
    },

    async updatePassword(password) {
      validatePassword(password);
      const { error } = await client.auth.updateUser({ password });
      if (error) throw new Error(getAuthErrorMessage(error));
    },

    async signInWithGoogle() {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl },
      });
      if (error) throw new Error(getAuthErrorMessage(error));
      if (!data.url) {
        throw new Error(
          "Google sign-in could not start. Confirm the Google provider is configured in Supabase.",
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
  const errorCode = parameters.get("error_code");
  if (
    errorCode === "otp_expired" ||
    (parameters.get("error") && parameters.get("type") === "recovery")
  ) {
    return "This password recovery link is invalid or has expired. Request a new recovery email.";
  }
  return null;
}
