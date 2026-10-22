const { randomInt, randomUUID } = require("node:crypto");
const gameRegistry = require("./gameRegistry");
const { MAX_ROOM_CAPACITY } = require("./roomConfiguration");
const {
    DEFAULT_ROUND_COUNT,
    isSupportedRoundCount
} = require("./roundConfiguration");

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
const MAX_PLAYER_NAME_LENGTH = 20;

const rooms = new Map();
const playerRooms = new Map();

function advanceRevision(room) {
    room.revision += 1;
}

function refreshReminderSessionId(room) {
    room.reminderSessionId = [...room.finishedMatches.entries()]
        .reverse()
        .find(([, match]) => match.viewers.size > 0)?.[0] ?? null;
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

function validateVisibility(visibility) {
    if (visibility !== "public" && visibility !== "private") {
        throw new RoomError("INVALID_VISIBILITY", "Room visibility must be public or private.");
    }
    return visibility;
}

function getRoomCapacity(room) {
    const gameMaximum = gameRegistry.get(room.selectedGameId)?.supportedPlayers.max;
    return Math.min(MAX_ROOM_CAPACITY, gameMaximum ?? MAX_ROOM_CAPACITY);
}

function validateRoomCanAcceptPlayer(room) {
    if (room.status !== "lobby") {
        throw new RoomError("ROOM_NOT_IN_LOBBY", "That room is no longer accepting players.");
    }
    if (room.players.length >= getRoomCapacity(room)) {
        throw new RoomError("ROOM_FULL", "That room is full.");
    }
}

function createRoom(playerId, playerName, selectedGameId = gameRegistry.DEFAULT_GAME_ID, visibility = "private") {
    validatePlayerId(playerId);
    if (typeof selectedGameId !== "string" || !gameRegistry.get(selectedGameId)) {
        throw new RoomError("GAME_NOT_FOUND", "That game is not available.");
    }
    if (playerRooms.has(playerId)) {
        throw new RoomError("ALREADY_IN_ROOM", "You are already in a room.");
    }
    if (rooms.size >= ROOM_CODE_COUNT) {
        throw new RoomError("NO_ROOM_CODES", "No room codes are available.");
    }
    validateVisibility(visibility);

    const host = { id: playerId, name: normalizePlayerName(playerName), isReady: false, viewingResultsSessionId: null };
    const room = {
        code: generateRoomCode(),
        publicRoomId: randomUUID(),
        revision: 0,
        hostId: playerId,
        status: "lobby",
        visibility,
        selectedGameId,
        selectedRoundCount: DEFAULT_ROUND_COUNT,
        players: [host],
        finishedMatches: new Map(),
        reminderSessionId: null
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
    return addPlayerToRoom(room, playerId, playerName);
}

function findPublicRoom(publicRoomId) {
    if (typeof publicRoomId !== "string" || !publicRoomId) return null;
    return [...rooms.values()].find((room) => room.publicRoomId === publicRoomId) ?? null;
}

function joinPublicRoom(publicRoomId, playerId, playerName) {
    const room = findPublicRoom(publicRoomId);
    if (!room) {
        throw new RoomError("PUBLIC_ROOM_NOT_FOUND", "That public room is no longer available.");
    }
    if (room.visibility !== "public") {
        throw new RoomError("ROOM_NOT_PUBLIC", "That room is no longer public.");
    }
    return addPlayerToRoom(room, playerId, playerName);
}

function addPlayerToRoom(room, playerId, playerName) {
    validatePlayerId(playerId);
    if (playerRooms.has(playerId)) {
        throw new RoomError("ALREADY_IN_ROOM", "You are already in a room.");
    }
    const name = normalizePlayerName(playerName);
    validateRoomCanAcceptPlayer(room);
    const comparisonName = name.toLowerCase();
    if (room.players.some((player) => player.name.toLowerCase() === comparisonName)) {
        throw new RoomError(
            "DUPLICATE_PLAYER_NAME",
            "That name is already used in this room. Choose another name."
        );
    }
    const player = { id: playerId, name, isReady: false, viewingResultsSessionId: null };
    // Membership is reserved synchronously with capacity validation. Socket.IO
    // room joining happens later, but concurrent requests cannot claim this slot.
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
    for (const [sessionId, match] of room.finishedMatches) {
        match.viewers.delete(playerId);
        if (match.viewers.size === 0) {
            room.finishedMatches.delete(sessionId);
            refreshReminderSessionId(room);
        }
    }
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
    if (player.viewingResultsSessionId) {
        throw new RoomError("PLAYER_VIEWING_RESULTS", "Return from the completed results before changing readiness.");
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
    advanceRevision(room);
    return room;
}

function setRoomVisibility(playerId, visibility) {
    const room = getPlayerRoom(playerId);
    if (!room) throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    if (room.hostId !== playerId) throw new RoomError("NOT_HOST", "Only the host can change room visibility.");
    if (room.status !== "lobby") throw new RoomError("ROOM_NOT_IN_LOBBY", "Room visibility can only be changed in the lobby.");
    validateVisibility(visibility);
    if (room.visibility !== visibility) {
        room.visibility = visibility;
        advanceRevision(room);
    }
    return room;
}

function validatePlayerKick(hostId, targetPlayerId) {
    const room = getPlayerRoom(hostId);
    if (!room) throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    if (room.hostId !== hostId) throw new RoomError("NOT_HOST", "Only the host can remove a player.");
    if (room.status !== "lobby") throw new RoomError("ROOM_NOT_IN_LOBBY", "Players can only be removed from the lobby.");
    if (targetPlayerId === hostId) throw new RoomError("CANNOT_KICK_SELF", "The host cannot remove themselves.");
    const target = room.players.find(({ id }) => id === targetPlayerId);
    if (!target) throw new RoomError("TARGET_NOT_FOUND", "That player is no longer in this room.");
    return { room, target };
}

function transferHost(requesterId, targetPlayerId) {
    const room = getPlayerRoom(requesterId);
    if (!room) throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    if (room.hostId !== requesterId) throw new RoomError("NOT_HOST", "Only the current host can transfer host status.");
    if (room.status !== "lobby") throw new RoomError("ROOM_NOT_IN_LOBBY", "Host status can only be transferred in the lobby.");
    if (typeof targetPlayerId !== "string" || targetPlayerId.length === 0) {
        throw new RoomError("INVALID_PLAYER", "A valid target player is required.");
    }
    if (targetPlayerId === requesterId) {
        throw new RoomError("CANNOT_TRANSFER_HOST_TO_SELF", "You are already the host.");
    }
    const requester = room.players.find(({ id }) => id === requesterId);
    const target = room.players.find(({ id }) => id === targetPlayerId);
    if (!requester || playerRooms.get(requesterId) !== room.code) {
        throw new RoomError("NOT_IN_ROOM", "You are not in this room.");
    }
    if (!target || playerRooms.get(targetPlayerId) !== room.code) {
        throw new RoomError("TARGET_NOT_FOUND", "That player is no longer in this room.");
    }
    room.hostId = targetPlayerId;
    advanceRevision(room);
    return room;
}

function selectRoundCount(playerId, roundCount, expectedRevision) {
    const room = getPlayerRoom(playerId);
    if (!room) {
        throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    }
    if (room.hostId !== playerId) {
        throw new RoomError("NOT_HOST", "Only the host can select the number of rounds.");
    }
    if (room.status !== "lobby") {
        throw new RoomError("ROOM_NOT_IN_LOBBY", "The room is no longer in the lobby.");
    }
    if (!isSupportedRoundCount(roundCount)) {
        throw new RoomError(
            "INVALID_ROUND_COUNT",
            "Choose 5, 7, or 10 rounds."
        );
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision !== room.revision) {
        throw new RoomError(
            "STALE_ROOM_STATE",
            "The lobby changed. Review the current settings and try again."
        );
    }
    if (room.selectedRoundCount === roundCount) {
        return room;
    }

    room.selectedRoundCount = roundCount;
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
    const eligiblePlayers = room.players.filter((player) => !player.viewingResultsSessionId);
    if (!eligiblePlayers.some(({ id }) => id === playerId)) {
        throw new RoomError("NOT_IN_LOBBY", "Return to the lobby before starting a game.");
    }
    if (eligiblePlayers.length < 2) {
        throw new RoomError("NOT_ENOUGH_PLAYERS", "At least 2 players are required to start.");
    }
    if (eligiblePlayers.some((player) => player.id !== room.hostId && !player.isReady)) {
        throw new RoomError("PLAYERS_NOT_READY", "Wait for all other players to be ready.");
    }

    return room;
}

function createGameStartRoom(room) {
    return { ...room, players: getLobbyParticipants(room).map((player) => ({ ...player })) };
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

function returnToLobby(playerId, sessionId, snapshot) {
    const room = validateReturnToLobby(playerId);
    room.status = "lobby";
    const matchPlayerIds = new Set(snapshot.players.map(({ id }) => id));
    for (const player of room.players) {
        if (matchPlayerIds.has(player.id)) {
            player.isReady = false;
            player.viewingResultsSessionId = player.id === playerId ? null : sessionId;
        }
    }
    room.finishedMatches.set(sessionId, {
        snapshot,
        viewers: new Set(room.players.filter(({ id, viewingResultsSessionId }) =>
            matchPlayerIds.has(id) && viewingResultsSessionId === sessionId
        ).map(({ id }) => id))
    });
    refreshReminderSessionId(room);
    advanceRevision(room);
    return room;
}

function getLobbyParticipants(room) {
    return room.players.filter(({ viewingResultsSessionId }) => !viewingResultsSessionId);
}

function returnResultsViewer(playerId, sessionId) {
    const room = getPlayerRoom(playerId);
    if (!room) throw new RoomError("NOT_IN_ROOM", "You are not in a room.");
    const player = room.players.find(({ id }) => id === playerId);
    if (!player || player.viewingResultsSessionId !== sessionId) {
        throw new RoomError("STALE_RESULTS_SESSION", "Those completed results are no longer available to return from.");
    }
    const match = room.finishedMatches.get(sessionId);
    if (!match || !match.viewers.has(playerId)) {
        throw new RoomError("STALE_RESULTS_SESSION", "Those completed results are no longer available to return from.");
    }
    player.viewingResultsSessionId = null;
    player.isReady = false;
    match.viewers.delete(playerId);
    if (match.viewers.size === 0) {
        room.finishedMatches.delete(sessionId);
        refreshReminderSessionId(room);
    }
    advanceRevision(room);
    return room;
}

function getResultsViewers(room, sessionId) {
    const match = room?.finishedMatches.get(sessionId);
    if (!match) return [];
    return room.players.filter(({ id, viewingResultsSessionId }) =>
        viewingResultsSessionId === sessionId && match.viewers.has(id)
    ).map(({ id }) => id);
}

function getFinishedMatch(room, sessionId) {
    return room?.finishedMatches.get(sessionId) ?? null;
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
    const maxPlayers = getRoomCapacity(room);
    const lobbyPlayers = getLobbyParticipants(room);
    const readinessStatus = room.status !== "lobby"
        ? "starting"
        : lobbyPlayers.length < selectedGame.supportedPlayers.min
          ? "insufficient-players"
          : lobbyPlayers.some((player) => player.id !== room.hostId && !player.isReady)
            ? "waiting-for-ready"
            : "ready";
    return {
        roomCode: room.code,
        revision: room.revision,
        status: room.status,
        visibility: room.visibility,
        playerCount: room.status === "lobby" ? getLobbyParticipants(room).length : room.players.length,
        maxPlayers,
        readinessStatus,
        selectedGameId: room.selectedGameId,
        selectedRoundCount: room.selectedRoundCount,
        reminderSessionId: room.reminderSessionId,
        selectedGame: {
            id: selectedGame.id,
            displayName: selectedGame.displayName,
            description: selectedGame.description,
            minPlayers: selectedGame.supportedPlayers.min,
            maxPlayers,
            supportsRoundSelection: selectedGame.supportsRoundSelection === true
        },
        availableGames: gameRegistry.list(),
        players: room.players.map((player) => ({
            id: player.id,
            name: player.name,
            isHost: player.id === room.hostId,
            isReady: player.isReady,
            isInGame: Boolean(player.viewingResultsSessionId)
        }))
    };
}

function listPublicRooms() {
    return [...rooms.values()]
        .filter((room) => room.visibility === "public" && room.status === "lobby" && room.players.length < getRoomCapacity(room))
        .map((room) => {
            const game = gameRegistry.get(room.selectedGameId);
            const host = room.players.find((player) => player.id === room.hostId);
            return {
                roomId: room.publicRoomId,
                hostName: host.name,
                gameId: game.id,
                gameName: game.displayName,
                gameDescription: game.description,
                playerCount: room.players.length,
                maxPlayers: getRoomCapacity(room),
                status: "lobby"
            };
        })
        .sort((left, right) =>
            right.playerCount / right.maxPlayers - left.playerCount / left.maxPlayers ||
            right.playerCount - left.playerCount ||
            (left.roomId < right.roomId ? -1 : left.roomId > right.roomId ? 1 : 0)
        );
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
    MAX_ROOM_CAPACITY,
    ROOM_CODE_COUNT,
    RoomError,
    createLobbyState,
    createRoom,
    cancelRoomStart,
    getPlayerRoom,
    getRoom,
    joinRoom,
    joinPublicRoom,
    listPublicRooms,
    normalizePlayerName,
    removePlayer,
    removeRoom,
    returnToLobby,
    getLobbyParticipants,
    returnResultsViewer,
    getResultsViewers,
    getFinishedMatch,
    recoverRoomToLobby,
    selectGame,
    setRoomVisibility,
    validatePlayerKick,
    transferHost,
    selectRoundCount,
    setPlayerReady,
    startRoom,
    validateRoomStart,
    createGameStartRoom,
    validateReturnToLobby
};
