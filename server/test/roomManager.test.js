const assert = require("node:assert/strict");
const test = require("node:test");
const roomManager = require("../roomManager");

const ROOM_CODE_PATTERN = /^[A-Z]{4}$/;

test("creates rooms with unique codes and the creator as host and first player", (context) => {
    const rooms = [];

    context.after(() => {
        for (const room of rooms) {
            roomManager.removeRoom(room.code);
        }
    });

    for (let index = 0; index < 50; index += 1) {
        rooms.push(roomManager.createRoom(`player-${index}`, `Player ${index}`));
    }

    assert.equal(
        new Set(rooms.map((room) => room.code)).size,
        rooms.length,
        "room codes should be unique"
    );

    for (let index = 0; index < rooms.length; index += 1) {
        const room = rooms[index];
        assert.match(room.code, ROOM_CODE_PATTERN);
        assert.equal(room.hostId, `player-${index}`);
        assert.deepEqual(room.players, [
            { id: `player-${index}`, name: `Player ${index}`, isReady: false, viewingResultsSessionId: null },
        ]);
    }
});

test("creates a room with a registered selected game and rejects unknown game IDs", (context) => {
    const room = roomManager.createRoom("selected-game-host", "Host", "fact-or-cap-anime");
    context.after(() => roomManager.removeRoom(room.code));
    assert.equal(room.selectedGameId, "fact-or-cap-anime");
    assert.throws(
        () => roomManager.createRoom("invalid-game-host", "Host", "not-a-game"),
        { code: "GAME_NOT_FOUND" }
    );
    assert.equal(roomManager.getPlayerRoom("invalid-game-host"), null);
});

test("room-code pool is unique, four letters, and reports exhaustion without replacing rooms", (context) => {
    const rooms = [];
    context.after(() => {
        for (const room of rooms) {
            roomManager.removeRoom(room.code);
        }
    });

    for (let index = 0; index < roomManager.ROOM_CODE_COUNT; index += 1) {
        rooms.push(roomManager.createRoom(`pool-player-${index}`, `Player ${index}`));
    }
    const originalRooms = rooms.map((room) => roomManager.getRoom(room.code));

    assert.equal(new Set(rooms.map(({ code }) => code)).size, roomManager.ROOM_CODE_COUNT);
    assert.ok(rooms.every(({ code }) => ROOM_CODE_PATTERN.test(code)));
    assert.throws(
        () => roomManager.createRoom("pool-exhausted", "No Code"),
        { code: "NO_ROOM_CODES" }
    );
    assert.deepEqual(
        rooms.map((room) => roomManager.getRoom(room.code)),
        originalRooms
    );
});

test("synchronous concurrent room creation never reuses a code or overwrites a room", async (context) => {
    const rooms = await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
            Promise.resolve().then(() =>
                roomManager.createRoom(`parallel-${index}`, `Player ${index}`)
            )
        )
    );
    context.after(() => {
        for (const room of rooms) {
            roomManager.removeRoom(room.code);
        }
    });

    assert.equal(new Set(rooms.map(({ code }) => code)).size, rooms.length);
    for (const [index, room] of rooms.entries()) {
        assert.match(room.code, ROOM_CODE_PATTERN);
        assert.equal(room.hostId, `parallel-${index}`);
        assert.equal(roomManager.getRoom(room.code), room);
    }
});

test("room codes normalize to uppercase for lookup and joining", (context) => {
    const host = roomManager.createRoom("case-host", "Host");
    context.after(() => roomManager.removeRoom(host.code));

    const guest = roomManager.joinRoom(host.code.toLowerCase(), "case-guest", "Guest");
    assert.equal(guest.code, host.code);
    assert.equal(roomManager.getRoom(host.code.toLowerCase()), host);
    assert.equal(host.players.length, 2);
});

test("rooms start with five rounds and allow any additional player count", (context) => {
    const host = roomManager.createRoom("uncapped-host", "Host");
    context.after(() => roomManager.removeRoom(host.code));
    assert.equal(host.selectedRoundCount, 5);
    assert.equal(roomManager.createLobbyState(host).selectedRoundCount, 5);

    for (let index = 1; index < 12; index += 1) {
        roomManager.joinRoom(host.code, `uncapped-${index}`, `Player ${index}`);
    }
    assert.equal(host.players.length, 12);
});

test("round count changes require an eligible host and a current lobby revision", (context) => {
    const host = roomManager.createRoom("round-host", "Host");
    context.after(() => roomManager.removeRoom(host.code));
    const guest = roomManager.joinRoom(host.code, "round-guest", "Guest");

    for (const roundCount of [7, 10, 5]) {
        roomManager.selectRoundCount(host.hostId, roundCount, host.revision);
        assert.equal(host.selectedRoundCount, roundCount);
    }
    assert.throws(
        () => roomManager.selectRoundCount(guest.players[1].id, 7, host.revision),
        { code: "NOT_HOST" }
    );
    assert.throws(
        () => roomManager.selectRoundCount(host.hostId, 6, host.revision),
        { code: "INVALID_ROUND_COUNT" }
    );
    assert.throws(
        () => roomManager.selectRoundCount(host.hostId, 7, host.revision - 1),
        { code: "STALE_ROOM_STATE" }
    );

    roomManager.removePlayer(host.hostId);
    roomManager.selectRoundCount(guest.players[0].id, 7, guest.revision);
    assert.equal(guest.selectedRoundCount, 7);
});

test("player names are unique within one room after trimming and case normalization", (context) => {
    const room = roomManager.createRoom("unique-host", "Alex");
    context.after(() => roomManager.removeRoom(room.code));

    for (const name of ["alex", " Alex ", "ALEX"]) {
        assert.throws(
            () => roomManager.joinRoom(room.code, `duplicate-${name}`, name),
            {
                code: "DUPLICATE_PLAYER_NAME",
                message: "That name is already used in this room. Choose another name."
            }
        );
    }
    assert.equal(room.players.length, 1);
});

test("identical names are allowed in separate rooms and become reusable after removal", (context) => {
    const firstRoom = roomManager.createRoom("name-room-host-1", "Alex");
    const secondRoom = roomManager.createRoom("name-room-host-2", "alex");
    context.after(() => {
        roomManager.removeRoom(firstRoom.code);
        roomManager.removeRoom(secondRoom.code);
    });

    const guest = roomManager.joinRoom(firstRoom.code, "name-room-guest", "Guest");
    roomManager.removePlayer("name-room-guest");
    const replacement = roomManager.joinRoom(firstRoom.code, "name-room-replacement", " guest ");
    assert.equal(replacement.players.length, 2);
    assert.equal(replacement.players[1].name, "guest");
    assert.equal(secondRoom.players[0].name, "alex");
    assert.equal(guest.code, firstRoom.code);
});

test("simultaneous equivalent-name joins can only insert one player", async (context) => {
    const room = roomManager.createRoom("atomic-name-host", "Host");
    context.after(() => roomManager.removeRoom(room.code));

    const attempts = await Promise.allSettled([
        Promise.resolve().then(() => roomManager.joinRoom(room.code, "atomic-name-1", "Shared")),
        Promise.resolve().then(() => roomManager.joinRoom(room.code, "atomic-name-2", " shared ")),
    ]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = attempts.find(({ status }) => status === "rejected");
    assert.equal(rejected.reason.code, "DUPLICATE_PLAYER_NAME");
    assert.equal(room.players.length, 2);
});
