import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthService,
  getAuthErrorMessage,
  getAuthRedirectUrl,
  getRecoveryLinkError,
} from "../src/auth.ts";
import {
  createSocketAuthPayloadProvider,
  createSocketSessionChangeHandler,
} from "../src/socketAuth.ts";

const account = { id: "account-1", email: "player@example.com" };

function createMockAuth(overrides = {}) {
  const calls = [];
  const auth = {
    async getSession() {
      calls.push(["getSession"]);
      return {
        data: {
          session: {
            access_token: "mock-access-token",
            user: account,
          },
        },
        error: null,
      };
    },
    async signInWithPassword(payload) {
      calls.push(["signInWithPassword", payload]);
      return { data: { user: account }, error: null };
    },
    async signUp(payload) {
      calls.push(["signUp", payload]);
      return {
        data: { user: account, session: null },
        error: null,
      };
    },
    async signOut() {
      calls.push(["signOut"]);
      return { error: null };
    },
    async resend(payload) {
      calls.push(["resend", payload]);
      return { error: null };
    },
    async resetPasswordForEmail(email, options) {
      calls.push(["resetPasswordForEmail", email, options]);
      return { error: null };
    },
    async updateUser(payload) {
      calls.push(["updateUser", payload]);
      return { error: null };
    },
    async signInWithOAuth(payload) {
      calls.push(["signInWithOAuth", payload]);
      return { data: { url: "https://accounts.google.com/oauth" }, error: null };
    },
    ...overrides,
  };
  return { client: { auth }, calls };
}

test("registration uses redirect URL and exposes email-verification-required outcome", async () => {
  const { client, calls } = createMockAuth();
  const service = createAuthService(client, "http://localhost:5173");

  const result = await service.signUp(" player@example.com ", "long-enough-password");
  assert.equal(result.requiresEmailVerification, true);
  assert.deepEqual(calls[0], [
    "signUp",
    {
      email: "player@example.com",
      password: "long-enough-password",
      options: { emailRedirectTo: "http://localhost:5173" },
    },
  ]);
});

test("sign-in validates credentials and maps unconfirmed email to a resend-friendly message", async () => {
  const { client } = createMockAuth({
    async signInWithPassword() {
      return { data: { user: null }, error: new Error("Email not confirmed") };
    },
  });
  const service = createAuthService(client, "http://localhost:5173");
  await assert.rejects(
    service.signIn("player@example.com", "long-enough-password"),
    /Verify your email before signing in/,
  );
  await assert.rejects(service.signIn("not-an-email", "long-enough-password"), /valid email/);
  await assert.rejects(service.signIn("player@example.com", "short"), /at least 8 characters/);
});

test("sign-out and verification resend call official Supabase auth methods", async () => {
  const { client, calls } = createMockAuth();
  const service = createAuthService(client, "http://localhost:5173");
  await service.signOut();
  await service.resendVerification("player@example.com");
  assert.equal(calls[0][0], "signOut");
  assert.deepEqual(calls[1], [
    "resend",
    {
      type: "signup",
      email: "player@example.com",
      options: { emailRedirectTo: "http://localhost:5173" },
    },
  ]);
});

test("password recovery request and completion use the configured redirect and update password", async () => {
  const { client, calls } = createMockAuth();
  const service = createAuthService(client, "https://sussed.example/auth/callback");
  await service.requestPasswordRecovery("player@example.com");
  await service.updatePassword("new-long-password");
  assert.deepEqual(calls, [
    [
      "resetPasswordForEmail",
      "player@example.com",
      { redirectTo: "https://sussed.example/auth/callback" },
    ],
    ["updateUser", { password: "new-long-password" }],
  ]);
  await assert.rejects(service.updatePassword("short"), /at least 8 characters/);
});

test("Google sign-in initiates OAuth with a configured callback and reports disabled provider", async () => {
  const { client, calls } = createMockAuth();
  await createAuthService(client, "http://localhost:5173").signInWithGoogle();
  assert.deepEqual(calls[0], [
    "signInWithOAuth",
    {
      provider: "google",
      options: { redirectTo: "http://localhost:5173" },
    },
  ]);

  const disabled = createMockAuth({
    async signInWithOAuth() {
      return { data: { url: null }, error: new Error("provider is not enabled") };
    },
  });
  await assert.rejects(
    createAuthService(disabled.client, "http://localhost:5173").signInWithGoogle(),
    /Google sign-in is not enabled/,
  );
});

test("session restoration returns the active user without exposing its access token to UI state", async () => {
  const { client } = createMockAuth();
  const restored = await createAuthService(client, "http://localhost:5173").restoreSession();
  assert.equal(restored.user.email, account.email);
  assert.equal(restored.accessToken, "mock-access-token");
});

test("redirect selection and expired recovery-link handling are deterministic", () => {
  assert.equal(getAuthRedirectUrl("", "http://localhost:5173"), "http://localhost:5173");
  assert.equal(
    getAuthRedirectUrl(" https://sussed.example/auth/callback ", "http://localhost:5173"),
    "https://sussed.example/auth/callback",
  );
  assert.match(
    getRecoveryLinkError("#error=access_denied&error_code=otp_expired"),
    /invalid or has expired/,
  );
  assert.match(
    getRecoveryLinkError("", "?error=access_denied&error_code=otp_expired"),
    /invalid or has expired/,
  );
  assert.equal(getRecoveryLinkError("#access_token=valid-token&type=recovery"), null);
});

test("auth errors are presented safely without exposing arbitrary service messages", () => {
  assert.match(getAuthErrorMessage(new Error("invalid login credentials")), /not recognized/);
  assert.match(getAuthErrorMessage(new Error("provider_disabled")), /Google sign-in is not enabled/);
  assert.match(getAuthErrorMessage(new Error("unexpected internal detail")), /Authentication could not be completed/);
});

test("Socket.IO auth callback sends the current token, guest payload, and rejects session-read failures", async () => {
  let currentToken = "initial-token";
  const provideAuth = createSocketAuthPayloadProvider(async () => ({
    data: { session: { access_token: currentToken } },
    error: null,
  }));
  const readPayload = () => new Promise((resolve) => provideAuth(resolve));
  assert.deepEqual(await readPayload(), { accessToken: "initial-token" });
  currentToken = "refreshed-token";
  assert.deepEqual(await readPayload(), { accessToken: "refreshed-token" });

  const guest = await new Promise((resolve) => {
    createSocketAuthPayloadProvider(async () => ({
      data: { session: null },
      error: null,
    }))(resolve);
  });
  assert.deepEqual(guest, {});

  const logs = [];
  const failure = await new Promise((resolve) => {
    createSocketAuthPayloadProvider(
      async () => ({ data: { session: null }, error: new Error("storage failed") }),
      (message) => logs.push(message),
    )(resolve);
  });
  assert.deepEqual(failure, { accessToken: null });
  assert.equal(logs.length, 1);
});

test("Socket.IO reconnects cleanly when account identity changes but not on token refresh", async () => {
  const operations = [];
  const socket = {
    disconnect() { operations.push("disconnect"); },
    connect() { operations.push("connect"); },
  };
  const handleSession = createSocketSessionChangeHandler(socket);
  handleSession("INITIAL_SESSION", null);
  handleSession("SIGNED_IN", { user: { id: "account-1" } });
  await new Promise(queueMicrotask);
  assert.deepEqual(operations, ["disconnect", "connect"]);

  operations.length = 0;
  handleSession("TOKEN_REFRESHED", { user: { id: "account-1" } });
  await new Promise(queueMicrotask);
  assert.deepEqual(operations, []);

  handleSession("SIGNED_OUT", null);
  await new Promise(queueMicrotask);
  assert.deepEqual(operations, ["disconnect", "connect"]);
});
