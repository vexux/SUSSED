const { randomUUID } = require("node:crypto");
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
        sessionId: randomUUID(),
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

function createPublicGameState(session, playerId) {
    return {
        roomCode: session.roomCode,
        sessionId: session.sessionId,
        gameId: session.gameId,
        displayName: session.displayName,
        status: session.status,
        players: session.players.map(({ id, name }) => ({ id, name })),
        state: session.implementation.createPublicState(session.privateState, playerId)
    };
}

function performGameAction(
    roomCode,
    gameId,
    playerId,
    action,
    payload,
    viewerId = playerId,
    expectedSessionId
) {
    const session = sessions.get(roomCode);
    if (!session || session.status !== "active") {
        throw new GameSessionError("GAME_NOT_ACTIVE", "There is no active game in this room.");
    }
    if (expectedSessionId !== undefined && session.sessionId !== expectedSessionId) {
        throw new GameSessionError(
            "SESSION_MISMATCH",
            "That action belongs to a different game session."
        );
    }
    if (session.gameId !== gameId) {
        throw new GameSessionError("GAME_MISMATCH", "That game is not active in this room.");
    }
    if (typeof session.implementation.handleAction !== "function") {
        throw new GameSessionError("ACTION_NOT_SUPPORTED", "This game does not support that action.");
    }

    const result = session.implementation.handleAction(
        session.privateState,
        action,
        playerId,
        payload
    );
    if (
        session.implementation.isFinished?.(session.privateState) === true
    ) {
        session.status = "finished";
    }
    return {
        result,
        gameState: createPublicGameState(session, viewerId)
    };
}

function getPublicGameState(roomCode, playerId) {
    const session = sessions.get(roomCode);
    if (!session || (session.status !== "active" && session.status !== "finished")) {
        throw new GameSessionError("GAME_NOT_ACTIVE", "There is no active game in this room.");
    }
    if (!session.players.some((player) => player.id === playerId)) {
        throw new GameSessionError("NOT_A_GAME_PLAYER", "You are not participating in this game.");
    }
    return createPublicGameState(session, playerId);
}

function removeGame(roomCode, expectedSessionId) {
    const session = sessions.get(roomCode);
    if (
        expectedSessionId !== undefined &&
        (!session || session.sessionId !== expectedSessionId)
    ) {
        return false;
    }
    return sessions.delete(roomCode);
}

function retireFinishedGame(roomCode, expectedSessionId) {
    const session = sessions.get(roomCode);
    if (!session) {
        throw new GameSessionError(
            "GAME_SESSION_NOT_FOUND",
            "There is no game session to retire for this room."
        );
    }
    if (session.status !== "finished") {
        throw new GameSessionError(
            "GAME_NOT_FINISHED",
            "The game must be finished before returning to the lobby."
        );
    }
    if (session.sessionId !== expectedSessionId) {
        throw new GameSessionError(
            "SESSION_MISMATCH",
            "That request belongs to a different game session."
        );
    }
    sessions.delete(roomCode);
    return true;
}

function abortActiveGame(roomCode, expectedSessionId) {
    const session = sessions.get(roomCode);
    if (
        !session ||
        session.status !== "active" ||
        (expectedSessionId !== undefined && session.sessionId !== expectedSessionId)
    ) {
        return false;
    }
    sessions.delete(roomCode);
    return true;
}

module.exports = {
    abortActiveGame,
    GameSessionError,
    getGameDefinition,
    getPublicGameState,
    isPlayerCountSupported,
    performGameAction,
    retireFinishedGame,
    removeGame,
    startGame,
    validateGameStart
};
