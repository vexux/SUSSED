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
            { id: `player-${index}`, name: `Player ${index}`, isReady: false },
        ]);
    }
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
