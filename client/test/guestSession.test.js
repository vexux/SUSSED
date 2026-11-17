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
