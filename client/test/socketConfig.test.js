import assert from "node:assert/strict";
import test from "node:test";
import { resolveSocketConfiguration } from "../src/socketConfig.ts";

test("configured server URL is used in development and production", () => {
  for (const isProduction of [false, true]) {
    assert.deepEqual(
      resolveSocketConfiguration("https://games.example.com", isProduction),
      { serverUrl: "https://games.example.com", errorMessage: null },
    );
  }
});

test("development defaults to the local server when no URL is configured", () => {
  assert.deepEqual(resolveSocketConfiguration(undefined, false), {
    serverUrl: "http://localhost:3000",
    errorMessage: null,
  });
});

test("production reports a missing server URL instead of targeting localhost", () => {
  const configuration = resolveSocketConfiguration(" ", true);
  assert.equal(configuration.serverUrl, null);
  assert.match(configuration.errorMessage, /VITE_SERVER_URL/u);
});
