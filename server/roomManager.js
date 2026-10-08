const { randomInt } = require("node:crypto");

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_COUNT = ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH;

const rooms = new Map();

function generateRoomCode() {
    let code;

    do {
        code = "";
        for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
            code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
        }
    } while (rooms.has(code));

    return code;
}

function createRoom(playerId) {
    if (typeof playerId !== "string" || playerId.length === 0) {
        throw new TypeError("A player ID is required to create a room.");
    }
    if (rooms.size >= ROOM_CODE_COUNT) {
        throw new Error("No room codes are available.");
    }

    const host = { id: playerId };
    const room = {
        code: generateRoomCode(),
        host,
        players: [host]
    };

    rooms.set(room.code, room);
    return room;
}

function removeRoom(roomCode) {
    return rooms.delete(roomCode);
}

module.exports = {
    createRoom,
    removeRoom
};
