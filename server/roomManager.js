const { randomInt } = require("node:crypto");
const gameRegistry = require("./gameRegistry");

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_COUNT = ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH;
const MAX_PLAYERS = 8;
const MAX_PLAYER_NAME_LENGTH = 20;

const rooms = new Map();
const playerRooms = new Map();

class RoomError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "RoomError";
        this.code = code;
    }
}

function validatePlayerId(playerId) {
    if (typeof playerId !== "string" || playerId.length === 0) {
        throw new RoomError("INVALID_PLAYER", "A valid player connection is required.");
    }
}

function normalizePlayerName(playerName) {
    if (
        typeof playerName !== "string" ||
        playerName.trim().length === 0 ||
        playerName.trim().length > MAX_PLAYER_NAME_LENGTH ||
        /[\u0000-\u001f\u007f]/u.test(playerName)
    ) {
        throw new RoomError(
            "INVALID_NAME",
            `Enter a player name between 1 and ${MAX_PLAYER_NAME_LENGTH} characters.`
        );
    }

    return playerName.trim();
}

function normalizeRoomCode(roomCode) {
    if (typeof roomCode !== "string") {
        return "";
    }
    return roomCode.trim().toUpperCase();
}

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

function createRoom(playerId, playerName) {
    validatePlayerId(playerId);
    if (playerRooms.has(playerId)) {
        throw new RoomError("ALREADY_IN_ROOM", "You are already in a room.");
    }
    if (rooms.size >= ROOM_CODE_COUNT) {
        throw new RoomError("NO_ROOM_CODES", "No room codes are available.");
    }

    const host = { id: playerId, name: normalizePlayerName(playerName), isReady: false };
    const room = {
        code: generateRoomCode(),
        hostId: playerId,
        status: "lobby",
        selectedGameId: gameRegistry.DEFAULT_GAME_ID,
        players: [host]
    };

    rooms.set(room.code, room);
    playerRooms.set(playerId, room.code);
    return room;
}

function joinRoom(roomCode, playerId, playerName) {
    validatePlayerId(playerId);
    const code = normalizeRoomCode(roomCode);
    const room = rooms.get(code);

    if (!room) {
        throw new RoomError("ROOM_NOT_FOUND", "That room code was not found.");
    }
    if (playerRooms.has(playerId)) {
        throw new RoomError("ALREADY_IN_ROOM", "You are already in a room.");
    }

    const name = normalizePlayerName(playerName);
    if (room.status !== "lobby") {
        throw new RoomError("ROOM_NOT_IN_LOBBY", "That room is no longer accepting players.");
    }
    if (room.players.length >= MAX_PLAYERS) {
        throw new RoomError("ROOM_FULL", "That room is full.");
    }

    const player = { id: playerId, name, isReady: false };
    room.players.push(player);
    playerRooms.set(playerId, room.code);
    return room;
}

function removePlayer(playerId) {
    const roomCode = playerRooms.get(playerId);
    if (!roomCode) {
        return null;
    }

    const room = rooms.get(roomCode);
    playerRooms.delete(playerId);
    if (!room) {
        return null;
    }

    room.players = room.players.filter((player) => player.id !== playerId);
    if (room.players.length === 0) {
        rooms.delete(roomCode);
        return null;
    }

    if (room.hostId === playerId) {
        room.hostId = room.players[0].id;
    }

    return room;
}

function setPlayerReady(playerId, isReady) {
    if (typeof isReady !== "boolean") {
        throw new RoomError("INVALID_READY_STATE", "Ready state must be true or false.");
    }

    const room = getPlayerRoom(playerId);
    if (!room) {
        throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    }
    if (room.status !== "lobby") {
        throw new RoomError("ROOM_NOT_IN_LOBBY", "The room is no longer in the lobby.");
    }

    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) {
        throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    }
    player.isReady = isReady;
    return room;
}

function selectGame(playerId, gameId) {
    const room = getPlayerRoom(playerId);
    if (!room) {
        throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    }
    if (room.hostId !== playerId) {
        throw new RoomError("NOT_HOST", "Only the host can select a game.");
    }
    if (room.status !== "lobby") {
        throw new RoomError("ROOM_NOT_IN_LOBBY", "The room is no longer in the lobby.");
    }
    if (typeof gameId !== "string" || !gameRegistry.get(gameId)) {
        throw new RoomError("GAME_NOT_FOUND", "That game is not available.");
    }

    room.selectedGameId = gameId;
    for (const player of room.players) {
        if (player.id !== room.hostId) {
            player.isReady = false;
        }
    }
    return room;
}

function validateRoomStart(playerId) {
    const room = getPlayerRoom(playerId);
    if (!room) {
        throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    }
    if (room.hostId !== playerId) {
        throw new RoomError("NOT_HOST", "Only the host can start the game.");
    }
    if (room.status !== "lobby") {
        throw new RoomError("ROOM_NOT_IN_LOBBY", "The room is no longer in the lobby.");
    }
    if (room.players.length < 2) {
        throw new RoomError("NOT_ENOUGH_PLAYERS", "At least 2 players are required to start.");
    }
    if (room.players.some((player) => player.id !== room.hostId && !player.isReady)) {
        throw new RoomError("PLAYERS_NOT_READY", "Wait for all other players to be ready.");
    }

    return room;
}

function startRoom(playerId) {
    const room = validateRoomStart(playerId);
    room.status = "starting";
    return room;
}

function getRoom(roomCode) {
    return rooms.get(normalizeRoomCode(roomCode)) ?? null;
}

function getPlayerRoom(playerId) {
    const roomCode = playerRooms.get(playerId);
    return roomCode ? rooms.get(roomCode) ?? null : null;
}

function createLobbyState(room) {
    const selectedGame = gameRegistry.get(room.selectedGameId);
    return {
        roomCode: room.code,
        status: room.status,
        playerCount: room.players.length,
        selectedGameId: room.selectedGameId,
        selectedGame: {
            id: selectedGame.id,
            displayName: selectedGame.displayName,
            minPlayers: selectedGame.supportedPlayers.min,
            maxPlayers: selectedGame.supportedPlayers.max
        },
        availableGames: gameRegistry.list(),
        players: room.players.map((player) => ({
            id: player.id,
            name: player.name,
            isHost: player.id === room.hostId,
            isReady: player.isReady
        }))
    };
}

function removeRoom(roomCode) {
    const code = normalizeRoomCode(roomCode);
    const room = rooms.get(code);
    if (!room) {
        return false;
    }

    for (const player of room.players) {
        playerRooms.delete(player.id);
    }
    return rooms.delete(code);
}

module.exports = {
    MAX_PLAYERS,
    RoomError,
    createLobbyState,
    createRoom,
    getPlayerRoom,
    getRoom,
    joinRoom,
    normalizePlayerName,
    removePlayer,
    removeRoom,
    selectGame,
    setPlayerReady,
    startRoom,
    validateRoomStart
};
