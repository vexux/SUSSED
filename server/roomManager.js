const { randomInt } = require("node:crypto");
const gameRegistry = require("./gameRegistry");

const ROOM_CODE_WORDS = [
    "ATOM", "BARD", "BARK", "BEAM", "BIRD", "BOLD", "BOLT", "CAMP",
    "CAVE", "CLAP", "COVE", "DASH", "DECK", "DICE", "DOME", "DUCK",
    "ECHO", "FAIR", "FAST", "FIZZ", "FLIP", "FROG", "GLOW", "GOON",
    "GRIN", "HIVE", "JAZZ", "JOLT", "JUMP", "KITE", "LAVA", "LEAF",
    "LIME", "LOOT", "LUCK", "LUNA", "MINT", "MOON", "MOSS", "NEST",
    "NOVA", "ORCA", "PACK", "PEAK", "POGO", "POND", "QUIZ", "RAIN",
    "RAMP", "RING", "ROAR", "ROCK", "RUSH", "SAGE", "SAND", "SEED",
    "SHIP", "SODA", "SOUP", "STAR", "TACO", "TENT", "TIDE", "TUNE",
    "VAST", "VIBE", "WAVE", "WILD", "WING", "WISE", "WOLF", "ZANY",
    "ZEST", "ZING"
];
const ROOM_CODE_COUNT = ROOM_CODE_WORDS.length;
const MAX_PLAYERS = 8;
const MAX_PLAYER_NAME_LENGTH = 20;

const rooms = new Map();
const playerRooms = new Map();

function advanceRevision(room) {
    room.revision += 1;
}

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
    const startIndex = randomInt(ROOM_CODE_WORDS.length);
    for (let offset = 0; offset < ROOM_CODE_WORDS.length; offset += 1) {
        const code = ROOM_CODE_WORDS[(startIndex + offset) % ROOM_CODE_WORDS.length];
        if (!rooms.has(code)) {
            return code;
        }
    }
    throw new RoomError("NO_ROOM_CODES", "No room codes are available.");
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
        revision: 0,
        hostId: playerId,
        status: "lobby",
        selectedGameId: gameRegistry.DEFAULT_GAME_ID,
        players: [host]
    };

    if (rooms.has(room.code)) {
        throw new RoomError(
            "ROOM_CODE_COLLISION",
            "A room with that code already exists. Please try again."
        );
    }
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
    advanceRevision(room);
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

    advanceRevision(room);
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
    advanceRevision(room);
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
    advanceRevision(room);
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
    advanceRevision(room);
    return room;
}

function validateReturnToLobby(playerId) {
    const room = getPlayerRoom(playerId);
    if (!room) {
        throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    }
    if (room.hostId !== playerId) {
        throw new RoomError("NOT_HOST", "Only the host can return the room to the lobby.");
    }
    if (room.status !== "starting") {
        throw new RoomError("ROOM_NOT_IN_GAME", "The room is not in a game.");
    }
    return room;
}

function returnToLobby(playerId) {
    const room = validateReturnToLobby(playerId);
    room.status = "lobby";
    for (const player of room.players) {
        player.isReady = false;
    }
    advanceRevision(room);
    return room;
}

function recoverRoomToLobby(room) {
    if (!room || rooms.get(room.code) !== room || room.status !== "starting") {
        throw new RoomError(
            "ROOM_NOT_IN_GAME",
            "The room cannot be recovered to the lobby."
        );
    }
    room.status = "lobby";
    for (const player of room.players) {
        player.isReady = false;
    }
    advanceRevision(room);
    return room;
}

function cancelRoomStart(room) {
    if (!room || rooms.get(room.code) !== room || room.status !== "starting") {
        throw new RoomError(
            "ROOM_NOT_IN_GAME",
            "The room cannot cancel its start transition."
        );
    }
    room.status = "lobby";
    advanceRevision(room);
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
        revision: room.revision,
        status: room.status,
        playerCount: room.players.length,
        selectedGameId: room.selectedGameId,
        selectedGame: {
            id: selectedGame.id,
            displayName: selectedGame.displayName,
            description: selectedGame.description,
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
    ROOM_CODE_COUNT,
    RoomError,
    createLobbyState,
    createRoom,
    cancelRoomStart,
    getPlayerRoom,
    getRoom,
    joinRoom,
    normalizePlayerName,
    removePlayer,
    removeRoom,
    returnToLobby,
    recoverRoomToLobby,
    selectGame,
    setPlayerReady,
    startRoom,
    validateRoomStart,
    validateReturnToLobby
};
