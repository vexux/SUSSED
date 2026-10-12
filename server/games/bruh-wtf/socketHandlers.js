const gameManager = require("../../gameManager");
const roomManager = require("../../roomManager");
const { BruhWtfError } = require("./game");

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acknowledgeError(acknowledge, code, message) {
    if (typeof acknowledge === "function") acknowledge({ error: { code, message } });
}

function getError(error) {
    if (error instanceof BruhWtfError || error instanceof gameManager.GameSessionError) {
        return { code: error.code, message: error.message };
    }
    console.error("Bruh wtf? operation failed:", error);
    return { code: "INTERNAL_ERROR", message: "The game action could not be completed." };
}

function getRoomAndGame(socket, payload) {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) throw new gameManager.GameSessionError("NOT_IN_ROOM", "You are not in a room.");
    const game = gameManager.getPublicGameState(room.code, socket.id);
    if (game.gameId !== "bruh-wtf") {
        throw new gameManager.GameSessionError("GAME_MISMATCH", "Bruh wtf? is not active in this room.");
    }
    if (payload.sessionId !== game.sessionId) {
        throw new gameManager.GameSessionError("SESSION_MISMATCH", "That action belongs to a different game session.");
    }
    if (payload.roundId !== game.state.roundId) {
        throw new BruhWtfError("ROUND_MISMATCH", "That action belongs to a different round.");
    }
    return { room, game };
}

function broadcastPlayerStates(io, roomCode, players) {
    for (const player of players) {
        io.to(player.id).emit("game-state", gameManager.getPublicGameState(roomCode, player.id));
    }
}

function registerSocketHandlers(io, socket) {
    socket.on("bruh-wtf:submit", (payload, acknowledge) => {
        if (typeof acknowledge !== "function") return;
        if (!isRecord(payload) || Object.keys(payload).length !== 3 || typeof payload.sessionId !== "string" || typeof payload.roundId !== "string" || typeof payload.answer !== "string") {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "An answer, sessionId, and current roundId are required.");
            return;
        }
        try {
            const { room, game } = getRoomAndGame(socket, payload);
            const action = gameManager.performGameAction(room.code, game.gameId, socket.id, "submit-answer", payload.answer, socket.id, payload.sessionId);
            broadcastPlayerStates(io, room.code, action.gameState.players);
            acknowledge(action.result);
        } catch (error) {
            const result = getError(error);
            acknowledgeError(acknowledge, result.code, result.message);
        }
    });

    socket.on("bruh-wtf:vote", (payload, acknowledge) => {
        if (typeof acknowledge !== "function") return;
        if (!isRecord(payload) || Object.keys(payload).length !== 3 || typeof payload.sessionId !== "string" || typeof payload.roundId !== "string" || typeof payload.optionId !== "string") {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "An optionId, sessionId, and current roundId are required.");
            return;
        }
        try {
            const { room, game } = getRoomAndGame(socket, payload);
            const action = gameManager.performGameAction(room.code, game.gameId, socket.id, "vote", payload.optionId, socket.id, payload.sessionId);
            broadcastPlayerStates(io, room.code, action.gameState.players);
            if (action.gameState.state.phase === "waiting-for-results") {
                gameManager.performGameAction(room.code, game.gameId, null, "publish-results", undefined, undefined, payload.sessionId);
                broadcastPlayerStates(io, room.code, action.gameState.players);
            }
            acknowledge(action.result);
        } catch (error) {
            const result = getError(error);
            acknowledgeError(acknowledge, result.code, result.message);
        }
    });

    socket.on("bruh-wtf:continue", (payload, acknowledge) => {
        if (typeof acknowledge !== "function") return;
        if (!isRecord(payload) || Object.keys(payload).length !== 2 || typeof payload.sessionId !== "string" || typeof payload.roundId !== "string") {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "The current sessionId and roundId are required to continue.");
            return;
        }
        try {
            const { room, game } = getRoomAndGame(socket, payload);
            const action = gameManager.performGameAction(room.code, game.gameId, socket.id, "continue", undefined, socket.id, payload.sessionId);
            broadcastPlayerStates(io, room.code, action.gameState.players);
            acknowledge(action.result);
        } catch (error) {
            const result = getError(error);
            acknowledgeError(acknowledge, result.code, result.message);
        }
    });
}

module.exports = { broadcastPlayerStates, registerSocketHandlers };
