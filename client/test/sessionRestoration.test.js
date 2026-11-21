import assert from "node:assert/strict";
import test from "node:test";
import { chooseRestoredGame, shouldClearGameOnLobbyUpdate } from "../src/sessionRestoration.ts";

test("room updates preserve current results and retire archived results on viewer return", () => {
  assert.equal(shouldClearGameOnLobbyUpdate("starting", false, false), false);
  assert.equal(shouldClearGameOnLobbyUpdate("lobby", false, true), false);
  assert.equal(shouldClearGameOnLobbyUpdate("starting", true, true), false);
  assert.equal(shouldClearGameOnLobbyUpdate("starting", true, false), true);
  assert.equal(shouldClearGameOnLobbyUpdate("lobby", true, false), true);
  assert.equal(shouldClearGameOnLobbyUpdate("lobby", false, false), true);
});

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
test("delayed lobby restoration rechecks an intervening start, host transfer and seat expiry", async () => {
  const snapshot = { roomCode:"ABCD", revision:1, status:"lobby", hostId:"old" };
  const latest = { ...snapshot, revision:4, status:"starting", hostId:"new", players:[{id:"new"}] };
  const { needsFreshGameSnapshot } = await import("../src/sessionRestoration.ts");
  const started = game("next", 1);
  // The original snapshot and a newer starting lobby alone would select the waiting screen.
  assert.equal(chooseRestoredGame(null, started, snapshot.roomCode), null);
  assert.equal(needsFreshGameSnapshot(snapshot,latest), true);
  assert.equal(needsFreshGameSnapshot(latest,latest), false);
});
