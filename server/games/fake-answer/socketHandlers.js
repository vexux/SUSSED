const gameManager = require("../../gameManager");
const roomManager = require("../../roomManager");
const { FakeAnswerError } = require("./game");

const SUBMISSION_PHASE_DELAY_MS = 1500;

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acknowledgeError(acknowledge, code, message) {
    if (typeof acknowledge === "function") {
        acknowledge({ error: { code, message } });
    }
}

function getOperationError(error) {
    if (error instanceof FakeAnswerError || error instanceof gameManager.GameSessionError) {
        return { code: error.code, message: error.message };
    }

    console.error("Fake-answer operation failed:", error);
    return {
        code: "INTERNAL_ERROR",
        message: "The fake-answer operation could not be completed."
    };
}

function broadcastPlayerGameStates(io, roomCode, players) {
    for (const player of players) {
        io.to(player.id).emit(
            "game-state",
            gameManager.getPublicGameState(roomCode, player.id)
        );
    }
}

function validateRequestIdentity(roomCode, playerId, sessionId, roundId) {
    const currentGame = gameManager.getPublicGameState(roomCode, playerId);
    if (sessionId !== currentGame.sessionId) {
        throw new gameManager.GameSessionError(
            "SESSION_MISMATCH",
            "That action belongs to a different game session."
        );
    }
    if (roundId !== currentGame.state.roundId) {
        throw new FakeAnswerError(
            "ROUND_MISMATCH",
            "That action belongs to a different round."
        );
    }
    return currentGame.gameId;
}

function registerSocketHandlers(io, socket) {
    socket.on("fake-answer:submit", (payload, acknowledge) => {
        if (typeof acknowledge !== "function") {
            return;
        }
        if (
            !isRecord(payload) ||
            Object.keys(payload).length !== 3 ||
            typeof payload.sessionId !== "string" ||
            typeof payload.roundId !== "string" ||
            typeof payload.completion !== "string"
        ) {
            acknowledgeError(
                acknowledge,
                "INVALID_REQUEST",
                "A completion, sessionId, and current roundId are required."
            );
            return;
        }

        const room = roomManager.getPlayerRoom(socket.id);
        if (!room) {
            acknowledgeError(acknowledge, "NOT_IN_ROOM", "You are not in a room.");
            return;
        }

        try {
            const gameId = validateRequestIdentity(
                room.code,
                socket.id,
                payload.sessionId,
                payload.roundId
            );
            const result = gameManager.performGameAction(
                room.code,
                gameId,
                socket.id,
                "submit-completion",
                payload.completion,
                socket.id,
                payload.sessionId
            );
            if (result.gameState.state.phase === "reveal") {
                broadcastPlayerGameStates(io, room.code, result.gameState.players);
                gameManager.performGameAction(
                    room.code,
                    gameId,
                    null,
                    "begin-voting",
                    undefined,
                    undefined,
                    payload.sessionId
                );
                broadcastPlayerGameStates(io, room.code, result.gameState.players);
            } else {
                io.to(room.code).emit("game-state", result.gameState);
            }
            acknowledge(result.result);
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });

    socket.on("fake-answer:vote", (payload, acknowledge) => {
        if (typeof acknowledge !== "function") {
            return;
        }
        if (
            !isRecord(payload) ||
            Object.keys(payload).length !== 3 ||
            typeof payload.sessionId !== "string" ||
            typeof payload.roundId !== "string" ||
            typeof payload.optionId !== "string"
        ) {
            acknowledgeError(
                acknowledge,
                "INVALID_REQUEST",
                "An optionId, sessionId, and current roundId are required."
            );
            return;
        }

        const room = roomManager.getPlayerRoom(socket.id);
        if (!room) {
            acknowledgeError(acknowledge, "NOT_IN_ROOM", "You are not in a room.");
            return;
        }

        try {
            const gameId = validateRequestIdentity(
                room.code,
                socket.id,
                payload.sessionId,
                payload.roundId
            );
            const result = gameManager.performGameAction(
                room.code,
                gameId,
                socket.id,
                "vote",
                payload.optionId,
                socket.id,
                payload.sessionId
            );
            broadcastPlayerGameStates(io, room.code, result.gameState.players);
            if (result.gameState.state.phase === "waiting-for-results") {
                gameManager.performGameAction(
                    room.code,
                    gameId,
                    null,
                    "publish-results",
                    undefined,
                    undefined,
                    payload.sessionId
                );
                broadcastPlayerGameStates(io, room.code, result.gameState.players);
            }
            acknowledge(result.result);
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });

    socket.on("fake-answer:continue", (payload, acknowledge) => {
        if (typeof acknowledge !== "function") {
            return;
        }
        if (
            !isRecord(payload) ||
            Object.keys(payload).length !== 2 ||
            typeof payload.sessionId !== "string" ||
            typeof payload.roundId !== "string"
        ) {
            acknowledgeError(
                acknowledge,
                "INVALID_REQUEST",
                "The current sessionId and roundId are required to continue."
            );
            return;
        }

        const room = roomManager.getPlayerRoom(socket.id);
        if (!room) {
            acknowledgeError(acknowledge, "NOT_IN_ROOM", "You are not in a room.");
            return;
        }

        try {
            const gameId = validateRequestIdentity(
                room.code,
                socket.id,
                payload.sessionId,
                payload.roundId
            );
            const result = gameManager.performGameAction(
                room.code,
                gameId,
                socket.id,
                "continue",
                undefined,
                socket.id,
                payload.sessionId
            );
            broadcastPlayerGameStates(io, room.code, result.gameState.players);
            if (result.result.advanced) {
                scheduleSubmissionPhase(
                    io,
                    room.code,
                    result.gameState.sessionId,
                    result.gameState.state.roundId,
                    gameId
                );
            }
            acknowledge(result.result);
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });
}

function scheduleSubmissionPhase(io, roomCode, sessionId, roundId, gameId = "fact-or-cap") {
    const timer = setTimeout(() => {
        try {
            const result = gameManager.performGameAction(
                roomCode,
                gameId,
                null,
                "open-submissions",
                { roundId },
                undefined,
                sessionId
            );
            io.to(roomCode).emit("game-state", result.gameState);
        } catch (error) {
            if (
                error instanceof gameManager.GameSessionError &&
                ["GAME_NOT_ACTIVE", "SESSION_MISMATCH"].includes(error.code)
            ) {
                return;
            }
            if (
                error instanceof FakeAnswerError &&
                (error.code === "ROUND_MISMATCH" || error.code === "SUBMISSIONS_NOT_OPEN")
            ) {
                return;
            }
            const operationError = getOperationError(error);
            console.error("Could not open fake-answer submissions:", operationError.message);
        }
    }, SUBMISSION_PHASE_DELAY_MS);
    timer.unref();
}

module.exports = {
    broadcastPlayerGameStates,
    registerSocketHandlers,
    scheduleSubmissionPhase
};
