import assert from "node:assert/strict";
import test from "node:test";
import {
  FIREBASE_AUTH_EMULATOR_PROJECT_ID,
  FIREBASE_AUTH_EMULATOR_URL,
  resolveFirebaseAuthEmulatorConfig,
} from "../src/firebaseEmulator.ts";

test("Firebase Auth Emulator is enabled only in development for the demo project", () => {
  assert.deepEqual(
    resolveFirebaseAuthEmulatorConfig(
      "true",
      true,
      FIREBASE_AUTH_EMULATOR_PROJECT_ID,
    ),
    {
      enabled: true,
      error: null,
      url: FIREBASE_AUTH_EMULATOR_URL,
    },
  );
});

test("production builds reject an enabled Firebase Auth Emulator setting", () => {
  const config = resolveFirebaseAuthEmulatorConfig(
    "true",
    false,
    FIREBASE_AUTH_EMULATOR_PROJECT_ID,
  );

  assert.equal(config.enabled, false);
  assert.match(config.error, /only in a development build/);
  assert.equal(config.url, null);
});

test("emulator mode rejects non-demo projects and malformed settings", () => {
  assert.match(
    resolveFirebaseAuthEmulatorConfig("true", true, "sussed-167f0").error,
    /demo-sussed-167f0/,
  );
  assert.match(
    resolveFirebaseAuthEmulatorConfig("yes", true, FIREBASE_AUTH_EMULATOR_PROJECT_ID).error,
    /must be set to true or false/,
  );
});

test("normal Firebase Authentication remains unchanged when emulator mode is disabled", () => {
  assert.deepEqual(
    resolveFirebaseAuthEmulatorConfig(
      "false",
      true,
      "sussed-167f0",
    ),
    { enabled: false, error: null, url: null },
  );
});
