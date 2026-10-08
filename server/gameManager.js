const gameRegistry = require("./gameRegistry");

const sessions = new Map();

class GameSessionError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "GameSessionError";
        this.code = code;
    }
}

function isPlayerCountSupported(game, playerCount) {
    return (
        Number.isInteger(playerCount) &&
        playerCount >= game.supportedPlayers.min &&
        playerCount <= game.supportedPlayers.max
    );
}

function getGameDefinition(gameId) {
    const game = gameRegistry.get(gameId);
    if (!game) {
        throw new GameSessionError("GAME_NOT_FOUND", "That game is not available.");
    }
    return game;
}

function validatePlayerCount(game, playerCount) {
    if (!isPlayerCountSupported(game, playerCount)) {
        const supportedCount = game.supportedPlayers.min === game.supportedPlayers.max
            ? `exactly ${game.supportedPlayers.min}`
            : `${game.supportedPlayers.min} to ${game.supportedPlayers.max}`;
        throw new GameSessionError(
            "UNSUPPORTED_PLAYER_COUNT",
            `${game.displayName} supports ${supportedCount} players.`
        );
    }
}

function validateGameStart(room, gameId) {
    if (!room || room.status !== "lobby") {
        throw new GameSessionError("ROOM_NOT_IN_LOBBY", "The room is no longer in the lobby.");
    }
    if (sessions.has(room.code)) {
        throw new GameSessionError("GAME_ALREADY_STARTED", "A game session already exists for this room.");
    }
    const game = getGameDefinition(gameId);
    validatePlayerCount(game, room.players.length);
    return game;
}

function startGame(room, gameId) {
    if (!room || room.status !== "starting") {
        throw new GameSessionError("ROOM_NOT_STARTING", "The room must be starting before the game can begin.");
    }
    if (sessions.has(room.code)) {
        throw new GameSessionError("GAME_ALREADY_STARTED", "A game session already exists for this room.");
    }
    const game = getGameDefinition(gameId);
    validatePlayerCount(game, room.players.length);

    const initialState = game.createInitialState(
        room.players.map(({ id, name }) => ({ id, name }))
    );
    const privateState = game.start(initialState);
    const session = {
        roomCode: room.code,
        gameId: game.id,
        displayName: game.displayName,
        status: "active",
        players: room.players.map(({ id, name }) => ({ id, name })),
        implementation: game,
        privateState
    };
    sessions.set(room.code, session);
    return createPublicGameState(session);
}

function createPublicGameState(session) {
    return {
        roomCode: session.roomCode,
        gameId: session.gameId,
        displayName: session.displayName,
        status: session.status,
        players: session.players.map(({ id, name }) => ({ id, name })),
        state: session.implementation.createPublicState(session.privateState)
    };
}

function removeGame(roomCode) {
    return sessions.delete(roomCode);
}

module.exports = {
    GameSessionError,
    getGameDefinition,
    isPlayerCountSupported,
    removeGame,
    startGame,
    validateGameStart
};
