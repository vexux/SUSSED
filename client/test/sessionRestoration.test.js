import assert from "node:assert/strict";
import test from "node:test";
import { chooseRestoredGame } from "../src/sessionRestoration.ts";

function game(sessionId, revision, roomCode = "ABCD") {
  return {
    roomCode,
    sessionId,
    revision,
    gameId: "fact-or-cap",
    displayName: "Fact or Cap",
    status: "active",
    players: [],
    state: {},
  };
}

test("restoration keeps a higher same-session revision but never replaces the snapshot with another session", () => {
  const snapshot = game("current-session", 4);
  assert.equal(chooseRestoredGame(snapshot, game("current-session", 5), "ABCD").revision, 5);
  assert.equal(chooseRestoredGame(snapshot, game("current-session", 3), "ABCD"), snapshot);
  assert.equal(chooseRestoredGame(snapshot, game("stale-session", 99), "ABCD"), snapshot);
  assert.equal(chooseRestoredGame(snapshot, game("current-session", 99, "EFGH"), "ABCD"), snapshot);
  assert.equal(chooseRestoredGame(null, game("buffered-session", 1), "ABCD"), null);
});
