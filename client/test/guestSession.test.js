import assert from "node:assert/strict";
import test from "node:test";
import {
  attachRecoveryCredential,
  GUEST_RECOVERY_STORAGE_KEY,
  PENDING_RECOVERY_STORAGE_KEY,
  promoteRecoveryCredential,
  readRecoveryCredential,
  rejectRecoveryCredential,
  stageRecoveryCredential,
} from "../src/guestSession.ts";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const firstCredential = "a".repeat(64);
const nextCredential = "b".repeat(64);

test("recovery credentials prefer a pending rotation and promote only after the handshake is ready", () => {
  const storage = createStorage({ [GUEST_RECOVERY_STORAGE_KEY]: firstCredential });
  assert.deepEqual(readRecoveryCredential(storage), {
    credential: firstCredential,
    source: "current",
    error: null,
  });

  assert.deepEqual(stageRecoveryCredential(storage, nextCredential), { ok: true, error: null });
  assert.deepEqual(readRecoveryCredential(storage), {
    credential: nextCredential,
    source: "pending",
    error: null,
  });
  assert.deepEqual(promoteRecoveryCredential(storage), { ok: true, error: null });
  assert.equal(storage.getItem(GUEST_RECOVERY_STORAGE_KEY), nextCredential);
  assert.equal(storage.getItem(PENDING_RECOVERY_STORAGE_KEY), null);
});

test("the Socket.IO auth payload preserves Firebase auth and attaches the pending recovery token", () => {
  const storage = createStorage({
    [GUEST_RECOVERY_STORAGE_KEY]: firstCredential,
    [PENDING_RECOVERY_STORAGE_KEY]: nextCredential,
  });
  assert.deepEqual(attachRecoveryCredential({ accessToken: "firebase-id-token" }, storage), {
    authPayload: {
      accessToken: "firebase-id-token",
      recoveryCredential: nextCredential,
    },
    source: "pending",
    error: null,
  });
});

test("rejecting an invalid pending credential preserves the previous active credential", () => {
  const storage = createStorage({
    [GUEST_RECOVERY_STORAGE_KEY]: firstCredential,
    [PENDING_RECOVERY_STORAGE_KEY]: nextCredential,
  });
  assert.deepEqual(rejectRecoveryCredential(storage, "pending"), { ok: true, error: null });
  assert.deepEqual(readRecoveryCredential(storage), {
    credential: firstCredential,
    source: "current",
    error: null,
  });
});

test("invalid credential formats are not persisted", () => {
  const storage = createStorage();
  const result = stageRecoveryCredential(storage, "not-a-recovery-credential");
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid guest recovery credential/u);
  assert.equal(storage.getItem(PENDING_RECOVERY_STORAGE_KEY), null);
});

test("storage failures produce explicit errors without throwing", () => {
  const storage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.match(readRecoveryCredential(storage).error, /could not be read/u);
  assert.equal(stageRecoveryCredential(storage, firstCredential).ok, false);
  assert.equal(promoteRecoveryCredential(storage).ok, false);
  assert.equal(rejectRecoveryCredential(storage, "pending").ok, false);
});
test("middleware refusals retry one socket, preserve ownership credentials and stop at the bound", async () => {
  const {createHandshakeRetry, handleGuestHandshakeError} = await import("../src/guestSession.ts");
  const storage = createStorage({[GUEST_RECOVERY_STORAGE_KEY]:firstCredential});
  const attempts = [];
  let scheduled;
  const controller = createHandshakeRetry(
    () => attempts.push(readRecoveryCredential(storage).credential),
    (callback, delay) => { scheduled = {callback,delay}; return 1; },
    () => { scheduled = undefined; },
  );
  const refuse = code => handleGuestHandshakeError(code,storage,readRecoveryCredential(storage).source,controller.retry);
  const fire = () => { const task = scheduled; scheduled = undefined; task.callback(); };

  // The storage acknowledgement never arrived. Server still recognizes the old key.
  stageRecoveryCredential(storage,nextCredential);
  assert.equal(refuse("RECOVERY_ACK_TIMEOUT").code,"RECOVERY_ACK_TIMEOUT");
  fire();
  assert.equal(attempts.at(-1),nextCredential);
  assert.equal(refuse("INVALID_RECOVERY_CREDENTIAL").code,"INVALID_RECOVERY_CREDENTIAL");
  fire();
  assert.equal(attempts.at(-1),firstCredential);
  controller.reset();

  for (const delay of [1000,2000,4000,8000,16000,16000]) {
    assert.equal(refuse("PLAYER_ALREADY_CONNECTED").code,"PLAYER_ALREADY_CONNECTED");
    const task = scheduled;
    refuse("RECOVERY_IN_PROGRESS");
    assert.equal(task,scheduled);
    assert.equal(task.delay,delay);
    fire();
  }
  assert.equal(refuse("PLAYER_ALREADY_CONNECTED").code,"RECONNECT_EXHAUSTED");
  assert.equal(scheduled,undefined);
  controller.manual();
  assert.equal(attempts.length,9);
  assert.equal(attempts.at(-1),firstCredential);
  controller.reset();

  assert.equal(refuse("AUTH_DISABLED"),null);
  assert.equal(scheduled,undefined);
  assert.equal(handleGuestHandshakeError("RECOVERY_REPLAYED",null,"current",controller.retry).code,"RECOVERY_STORAGE_UNAVAILABLE");
  assert.equal(scheduled,undefined);
  // A restarted process cannot recognize the final stored credential.
  refuse("INVALID_RECOVERY_CREDENTIAL");
  fire();
  assert.equal(attempts.at(-1),null);
});
test("an overlapping handshake and a lost storage acknowledgement recover exactly one original identity", async () => {
  const { GuestIdentityManager } = await import("../../server/guestIdentityManager.js");
  const { createHandshakeRetry, handleGuestHandshakeError } = await import("../src/guestSession.ts");
  const manager = new GuestIdentityManager();
  const initial = manager.beginNewSession("old");
  const storage = createStorage({[GUEST_RECOVERY_STORAGE_KEY]: initial.recoveryCredential});
  manager.activateSocket("old", true);
  let nextAttempt;
  let attempts = 0;
  const controller = createHandshakeRetry(connect, callback => { nextAttempt = callback; return 1; }, () => {});
  const refusals = [];
  function connect() {
    attempts++;
    const {source, credential} = readRecoveryCredential(storage);
    try {
      const session = manager.beginRecovery("replacement", credential);
      assert.equal(session.playerId, initial.playerId);
      stageRecoveryCredential(storage, session.recoveryCredential);
      if (attempts === 2) {
        manager.abortSocket("replacement");
        refusals.push(handleGuestHandshakeError("RECOVERY_ACK_TIMEOUT", storage, source, controller.retry).code);
      } else {
        manager.activateSocket("replacement", true);
        promoteRecoveryCredential(storage);
        controller.reset();
      }
    } catch (error) {
      if (!error.code || error.code === "ERR_ASSERTION") throw error;
      refusals.push(handleGuestHandshakeError(error.code, storage, source, controller.retry).code);
    }
  }
  connect();
  manager.releaseSocket("old");
  nextAttempt(); // Server never received the staged key's storage acknowledgement.
  nextAttempt(); // Only the pending key is rejected and removed.
  nextAttempt(); // Previous active key is still valid.
  assert.deepEqual(refusals, ["PLAYER_ALREADY_CONNECTED","RECOVERY_ACK_TIMEOUT","INVALID_RECOVERY_CREDENTIAL"]);
  assert.equal(attempts, 4);
  assert.equal(manager.isActiveSocket(initial.playerId, "old"), false);
  assert.equal(manager.isActiveSocket(initial.playerId, "replacement"), true);
  assert.equal(manager.records.size, 1);
});
