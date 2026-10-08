const assert = require("node:assert/strict");
const test = require("node:test");
const roomManager = require("../roomManager");

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{4}$`);

test("creates rooms with unique codes and the creator as host and first player", (context) => {
    const rooms = [];

    context.after(() => {
        for (const room of rooms) {
            roomManager.removeRoom(room.code);
        }
    });

    for (let index = 0; index < 100; index += 1) {
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
            { id: `player-${index}`, name: `Player ${index}` },
        ]);
    }
});
