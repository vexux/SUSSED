const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../gameRegistry");
const manager = require("../gameManager");
const rooms = require("../roomManager");

// Deliberately use a private state shape unrelated to either production engine.
const fixture = {
    id: "contract-demo", displayName: "Contract demo", description: "Finish after one choice.",
    category: "Test", socketProtocol: "contract-demo", supportsRoundSelection: false,
    supportedPlayers: { min: 2, max: 3 },
    createInitialState: (players) => ({ members: new Set(players.map(({ id }) => id)), secret: 42 }),
    start: (state) => ({ ...state, done: false }),
    createPublicState: (state) => ({ phase: state.done ? "results" : "choosing" }),
    handleAction(state, action) {
        if (action !== "choose") throw new Error("Unknown choice");
        state.done = true;
        return { chosen: true };
    },
    removeParticipant: (state, id) => ({ removed: state.members.delete(id) }),
    setPlayerConnectionStatus: () => ({ advancedRound: false }),
    isParticipantEligible: (state, id) => state.members.has(id),
    isFinished: (state) => state.done
};

test("registration validates identifiers, metadata, player range and lifecycle hooks", () => {
    for (const invalid of [{ id: "Bad Id" }, { category: "" }, { supportedPlayers: { min: 4, max: 2 } }, { start: null }]) {
        assert.throws(() => registry.register({ ...fixture, ...invalid }), TypeError);
    }
    assert.equal(registry.get(fixture.id), null);
});

test("an independently registered game runs through real rooms, departure, actions and retirement", (t) => {
    registry.register(fixture);
    assert.throws(() => registry.register(fixture), /Duplicate game ID/);
    assert.equal(registry.list().find(({ id }) => id === fixture.id).category, "Test");
    const room = rooms.createRoom("host", "Host", fixture.id);
    t.after(() => { manager.removeGame(room.code); rooms.removeRoom(room.code); });
    assert.throws(() => manager.validateGameStart(room, fixture.id), { code: "UNSUPPORTED_PLAYER_COUNT" });
    for (const id of ["guest", "third"]) {
        rooms.joinRoom(room.code, id, id);
        rooms.setPlayerReady(id, true);
    }
    assert.throws(() => rooms.joinRoom(room.code, "fourth", "Fourth"), { code: "ROOM_FULL" });
    manager.validateGameStart(room, fixture.id);
    const game = manager.startGame(rooms.startRoom("host"), fixture.id);
    assert.deepEqual(game.state, { phase: "choosing" });
    manager.removeParticipant(room.code, "third", game.sessionId);
    const choose = (player, action) => manager.performGameAction(room.code, fixture.id, player, action, null, player, game.sessionId);
    assert.throws(() => choose("third", "choose"), { code: "NOT_A_GAME_PLAYER" });
    assert.throws(() => choose("guest", "invalid"), /Unknown choice/);
    assert.equal(choose("guest", "choose").gameState.status, "finished");
    assert.throws(() => choose("host", "choose"), { code: "GAME_NOT_ACTIVE" });
    assert.deepEqual(manager.retireFinishedGame(room.code, game.sessionId).state, { phase: "results" });
});
