import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthService,
  getAuthErrorMessage,
  getAuthRedirectUrl,
  getPasswordResetCode,
  getRecoveryLinkError,
} from "../src/auth.ts";
import {
  createSocketAuthPayloadProvider,
  createSocketSessionChangeHandler,
  createSocketTokenRefreshRetry,
  getFirebaseSocketAuthPayload,
} from "../src/socketAuth.ts";

function createUser({
  uid = "firebase-user-1",
  email = "player@example.com",
  emailVerified = false,
  providerId = "password",
} = {}) {
  return {
    uid,
    email,
    emailVerified,
    providerData: [{ providerId }],
    async getIdToken(forceRefresh = false) {
      return forceRefresh ? "fresh-id-token" : "current-id-token";
    },
  };
}

function createMockFirebase({ user = createUser(), apiOverrides = {} } = {}) {
  const calls = [];
  const client = {
    currentUser: user,
    async authStateReady() {
      calls.push(["authStateReady"]);
    },
  };
  const api = {
    async createUserWithEmailAndPassword(auth, email, password) {
      calls.push(["createUserWithEmailAndPassword", auth, email, password]);
      return { user };
    },
    async signInWithEmailAndPassword(auth, email, password) {
      calls.push(["signInWithEmailAndPassword", auth, email, password]);
      return { user };
    },
    async sendEmailVerification(currentUser, settings) {
      calls.push(["sendEmailVerification", currentUser, settings]);
    },
    async reload(currentUser) {
      calls.push(["reload", currentUser]);
    },
    async sendPasswordResetEmail(auth, email, settings) {
      calls.push(["sendPasswordResetEmail", auth, email, settings]);
    },
    async signOut(auth) {
      calls.push(["signOut", auth]);
    },
    async updatePassword(currentUser, password) {
      calls.push(["updatePassword", currentUser, password]);
    },
    async verifyPasswordResetCode(auth, code) {
      calls.push(["verifyPasswordResetCode", auth, code]);
      return "player@example.com";
    },
    async confirmPasswordReset(auth, code, password) {
      calls.push(["confirmPasswordReset", auth, code, password]);
    },
    GoogleAuthProvider: class {},
    async signInWithPopup(auth, provider) {
      calls.push(["signInWithPopup", auth, provider]);
      return { user };
    },
    ...apiOverrides,
  };
  return { client, api, calls };
}

const REDIRECT_URL = "http://localhost:5173";

test("registration sends Firebase verification email before reporting success", async () => {
  const { client, api, calls } = createMockFirebase();
  const result = await createAuthService(client, REDIRECT_URL, api)
    .signUp(" player@example.com ", "long-enough-password");

  assert.equal(result.requiresEmailVerification, true);
  assert.deepEqual(
    calls.map(([method]) => method),
    ["createUserWithEmailAndPassword", "sendEmailVerification"],
  );
  assert.deepEqual(calls[1], [
    "sendEmailVerification",
    client.currentUser,
    { url: REDIRECT_URL },
  ]);
});

test("registration surfaces verification delivery errors instead of reporting success", async () => {
  const { client, api } = createMockFirebase({
    apiOverrides: {
      async sendEmailVerification() {
        throw Object.assign(new Error("network failed"), {
          code: "auth/network-request-failed",
        });
      },
    },
  });

  await assert.rejects(
    createAuthService(client, REDIRECT_URL, api)
      .signUp("player@example.com", "long-enough-password"),
    /Could not reach Firebase/,
  );
});

test("email/password sign-in requires verification for unverified password accounts", async () => {
  const { client, api } = createMockFirebase();
  const result = await createAuthService(client, REDIRECT_URL, api)
    .signIn("player@example.com", "long-enough-password");

  assert.equal(result.requiresEmailVerification, true);
  assert.equal(result.user?.id, client.currentUser.uid);
  await assert.rejects(
    createAuthService(client, REDIRECT_URL, api).signIn("not-an-email", "long-enough-password"),
    /valid email/,
  );
  await assert.rejects(
    createAuthService(client, REDIRECT_URL, api).signIn("player@example.com", "short"),
    /at least 8 characters/,
  );
});

test("resend requires a signed-in password account and sends only when unverified", async () => {
  const missing = createMockFirebase({ user: null });
  await assert.rejects(
    createAuthService(missing.client, REDIRECT_URL, missing.api)
      .resendVerification("player@example.com"),
    /No signed-in account/,
  );

  const google = createMockFirebase({
    user: createUser({ providerId: "google.com", emailVerified: true }),
  });
  await assert.rejects(
    createAuthService(google.client, REDIRECT_URL, google.api)
      .resendVerification("player@example.com"),
    /does not use email\/password/,
  );

  const account = createMockFirebase();
  const result = await createAuthService(account.client, REDIRECT_URL, account.api)
    .resendVerification("player@example.com");
  assert.equal(result, "sent");
  assert.deepEqual(account.calls.map(([method]) => method), ["reload", "sendEmailVerification"]);

  const verified = createMockFirebase({
    apiOverrides: {
      async reload(user) {
        user.emailVerified = true;
      },
    },
  });
  assert.equal(
    await createAuthService(verified.client, REDIRECT_URL, verified.api)
      .resendVerification("player@example.com"),
    "already-verified",
  );
  assert.equal(
    verified.calls.some(([method]) => method === "sendEmailVerification"),
    false,
  );
});

test("Google users do not enter the email-verification flow", async () => {
  const { client, api, calls } = createMockFirebase({
    user: createUser({ providerId: "google.com", emailVerified: true }),
  });
  const service = createAuthService(client, REDIRECT_URL, api);
  await service.signInWithGoogle();
  assert.equal(calls.some(([method]) => method === "sendEmailVerification"), false);
});

test("sign-out, password recovery, and password change use Firebase APIs", async () => {
  const { client, api, calls } = createMockFirebase();
  const service = createAuthService(client, "https://sussed.example/auth/callback", api);
  await service.signOut();
  await service.requestPasswordRecovery("player@example.com");
  await service.updatePassword("new-long-password");
  assert.deepEqual(calls.map(([method]) => method), [
    "signOut",
    "sendPasswordResetEmail",
    "updatePassword",
  ]);
  assert.deepEqual(calls[1].slice(2), [
    "player@example.com",
    { url: "https://sussed.example/auth/callback" },
  ]);
});

test("password reset links are verified and completed with Firebase action-code APIs", async () => {
  const { client, api, calls } = createMockFirebase();
  const service = createAuthService(client, REDIRECT_URL, api);
  assert.equal(await service.verifyPasswordResetCode("reset-code"), "player@example.com");
  await service.confirmPasswordReset("reset-code", "another-long-password");
  assert.deepEqual(calls.map(([method]) => method), [
    "verifyPasswordResetCode",
    "confirmPasswordReset",
  ]);
  assert.deepEqual(calls[0], ["verifyPasswordResetCode", client, "reset-code"]);
  assert.deepEqual(calls[1], [
    "confirmPasswordReset",
    client,
    "reset-code",
    "another-long-password",
  ]);
});

test("session restoration waits for Firebase Auth and returns the current ID token", async () => {
  const { client, api, calls } = createMockFirebase();
  const restored = await createAuthService(client, REDIRECT_URL, api).restoreSession();
  assert.equal(restored.user?.email, "player@example.com");
  assert.equal(restored.requiresEmailVerification, true);
  assert.equal(restored.accessToken, "current-id-token");
  assert.deepEqual(calls.map(([method]) => method), ["authStateReady", "reload"]);
});

test("redirect selection, recovery-link errors, and Firebase error mapping are deterministic", () => {
  assert.equal(getAuthRedirectUrl("", REDIRECT_URL), REDIRECT_URL);
  assert.equal(
    getAuthRedirectUrl(" https://sussed.example/auth/callback ", REDIRECT_URL),
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
  assert.equal(getRecoveryLinkError("", "?error=access_denied"), null);
  assert.equal(
    getRecoveryLinkError("", "?mode=verifyEmail&error_code=invalid_action_code"),
    null,
  );
  assert.match(
    getRecoveryLinkError("", "?mode=resetPassword&error_code=invalid_action_code"),
    /invalid or has expired/,
  );
  assert.equal(getPasswordResetCode("?mode=resetPassword&oobCode=query-code", ""), "query-code");
  assert.equal(getPasswordResetCode("", "#mode=resetPassword&oobCode=hash-code"), "hash-code");
  assert.equal(getPasswordResetCode("?mode=verifyEmail&oobCode=verify-code", ""), null);
  assert.match(getRecoveryLinkError("", "?mode=resetPassword"), /invalid or has expired/);
  assert.equal(getRecoveryLinkError("#access_token=valid-token&type=recovery"), null);
  assert.match(getAuthErrorMessage({ code: "auth/too-many-requests" }), /temporarily limited/);
  assert.match(getAuthErrorMessage({ code: "auth/network-request-failed" }), /internet connection/);
  assert.match(getAuthErrorMessage({ code: "auth/unauthorized-continue-uri" }), /authorized domains/);
  assert.match(getAuthErrorMessage({ code: "auth/operation-not-allowed" }), /Enable it in Firebase/);
});

test("Socket.IO sends the refreshed Firebase ID token, allows guests, and excludes unverified email users", async () => {
  const authenticated = createMockFirebase({
    user: createUser({ emailVerified: true }),
  });
  assert.deepEqual(
    await getFirebaseSocketAuthPayload(authenticated.client, async () => {}),
    { accessToken: "current-id-token" },
  );
  assert.deepEqual(authenticated.calls, [["authStateReady"]]);

  const guest = createMockFirebase({ user: null });
  assert.deepEqual(await getFirebaseSocketAuthPayload(guest.client), {});

  const unverified = createMockFirebase();
  assert.deepEqual(
    await getFirebaseSocketAuthPayload(unverified.client, async () => {}),
    {},
  );

  const verifiedAfterReload = createMockFirebase({
    user: createUser({ emailVerified: true }),
  });
  assert.deepEqual(
    await getFirebaseSocketAuthPayload(verifiedAfterReload.client),
    { accessToken: "current-id-token" },
  );
});

test("Socket.IO auth callback uses latest tokens and fails closed when session loading fails", async () => {
  let currentToken = "initial-token";
  const provideAuth = createSocketAuthPayloadProvider(async () => ({
    accessToken: currentToken,
  }));
  const readPayload = () => new Promise((resolve) => provideAuth(resolve));
  assert.deepEqual(await readPayload(), { accessToken: "initial-token" });
  currentToken = "refreshed-token";
  assert.deepEqual(await readPayload(), { accessToken: "refreshed-token" });

  const guest = await new Promise((resolve) => {
    createSocketAuthPayloadProvider(async () => null)(resolve);
  });
  assert.deepEqual(guest, {});

  const logs = [];
  const failure = await new Promise((resolve) => {
    createSocketAuthPayloadProvider(
      async () => {
        throw new Error("session unavailable");
      },
      (message) => logs.push(message),
    )(resolve);
  });
  assert.deepEqual(failure, { accessToken: null });
  assert.equal(logs.length, 1);
});

test("invalid-token retry forces a fresh Firebase ID token once before reconnecting", async () => {
  const operations = [];
  const socket = {
    disconnect() { operations.push("disconnect"); },
    connect() { operations.push("connect"); },
  };
  const tokenRequests = [];
  const retry = createSocketTokenRefreshRetry(socket, () => ({
    async getIdToken(forceRefresh) {
      tokenRequests.push(forceRefresh);
      return "fresh-token";
    },
  }));

  assert.equal(await retry.refreshAndReconnect(), true);
  assert.equal(await retry.refreshAndReconnect(), false);
  assert.deepEqual(tokenRequests, [true]);
  assert.deepEqual(operations, ["disconnect", "connect"]);
  retry.reset();
  assert.equal(await retry.refreshAndReconnect(), true);
});

test("Socket.IO reconnects when account identity changes but not on token refresh", async () => {
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
