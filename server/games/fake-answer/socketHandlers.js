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

function registerSocketHandlers(io, socket) {
    socket.on("fake-answer:submit", (payload, acknowledge) => {
        if (typeof acknowledge !== "function") {
            return;
        }
        if (
            !isRecord(payload) ||
            Object.keys(payload).length !== 1 ||
            typeof payload.completion !== "string"
        ) {
            acknowledgeError(
                acknowledge,
                "INVALID_REQUEST",
                "A completion string is required."
            );
            return;
        }

        const room = roomManager.getPlayerRoom(socket.id);
        if (!room) {
            acknowledgeError(acknowledge, "NOT_IN_ROOM", "You are not in a room.");
            return;
        }

        try {
            const result = gameManager.performGameAction(
                room.code,
                "fake-answer",
                socket.id,
                "submit-completion",
                payload.completion
            );
            if (result.gameState.state.phase === "reveal") {
                broadcastPlayerGameStates(io, room.code, result.gameState.players);
                gameManager.performGameAction(
                    room.code,
                    "fake-answer",
                    null,
                    "begin-voting"
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
            Object.keys(payload).length !== 1 ||
            typeof payload.optionId !== "string"
        ) {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "An optionId is required.");
            return;
        }

        const room = roomManager.getPlayerRoom(socket.id);
        if (!room) {
            acknowledgeError(acknowledge, "NOT_IN_ROOM", "You are not in a room.");
            return;
        }

        try {
            const result = gameManager.performGameAction(
                room.code,
                "fake-answer",
                socket.id,
                "vote",
                payload.optionId
            );
            broadcastPlayerGameStates(io, room.code, result.gameState.players);
            if (result.gameState.state.phase === "waiting-for-results") {
                gameManager.performGameAction(
                    room.code,
                    "fake-answer",
                    null,
                    "publish-results"
                );
                broadcastPlayerGameStates(io, room.code, result.gameState.players);
            }
            acknowledge(result.result);
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });
}

function scheduleSubmissionPhase(io, roomCode) {
    const timer = setTimeout(() => {
        try {
            const result = gameManager.performGameAction(
                roomCode,
                "fake-answer",
                null,
                "open-submissions"
            );
            io.to(roomCode).emit("game-state", result.gameState);
        } catch (error) {
            if (
                error instanceof gameManager.GameSessionError &&
                error.code === "GAME_NOT_ACTIVE"
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
