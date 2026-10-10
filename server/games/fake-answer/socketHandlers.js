const gameManager = require("../../gameManager");
const roomManager = require("../../roomManager");
const { FakeAnswerError } = require("./game");

const SUBMISSION_PHASE_DELAY_MS = 1500;
const ACTION_PHASE_TIMEOUT_MS = 120_000;
const actionPhaseTimeouts = new Map();

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
            validateRequestIdentity(room.code, socket.id, payload.sessionId, payload.roundId);
            const result = gameManager.performGameAction(
                room.code,
                "fake-answer",
                socket.id,
                "submit-completion",
                payload.completion,
                socket.id,
                payload.sessionId
            );
            if (result.gameState.state.phase === "reveal") {
                clearActionPhaseTimeout(room.code, payload.sessionId);
                broadcastPlayerGameStates(io, room.code, result.gameState.players);
                gameManager.performGameAction(
                    room.code,
                    "fake-answer",
                    null,
                    "begin-voting",
                    undefined,
                    undefined,
                    payload.sessionId
                );
                broadcastPlayerGameStates(io, room.code, result.gameState.players);
                scheduleActionPhaseTimeout(
                    io,
                    room.code,
                    payload.sessionId,
                    payload.roundId,
                    "voting"
                );
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
            validateRequestIdentity(room.code, socket.id, payload.sessionId, payload.roundId);
            const result = gameManager.performGameAction(
                room.code,
                "fake-answer",
                socket.id,
                "vote",
                payload.optionId,
                socket.id,
                payload.sessionId
            );
            broadcastPlayerGameStates(io, room.code, result.gameState.players);
            if (result.gameState.state.phase === "waiting-for-results") {
                clearActionPhaseTimeout(room.code, payload.sessionId);
                const published = gameManager.performGameAction(
                    room.code,
                    "fake-answer",
                    null,
                    "publish-results",
                    undefined,
                    undefined,
                    payload.sessionId
                );
                broadcastPlayerGameStates(io, room.code, published.gameState.players);
                if (!published.gameState.state.isFinalRound) {
                    scheduleActionPhaseTimeout(
                        io,
                        room.code,
                        payload.sessionId,
                        payload.roundId,
                        "results"
                    );
                }
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
            validateRequestIdentity(room.code, socket.id, payload.sessionId, payload.roundId);
            const result = gameManager.performGameAction(
                room.code,
                "fake-answer",
                socket.id,
                "continue",
                undefined,
                socket.id,
                payload.sessionId
            );
            broadcastPlayerGameStates(io, room.code, result.gameState.players);
            if (result.result.advanced) {
                clearActionPhaseTimeout(room.code, payload.sessionId);
                scheduleSubmissionPhase(
                    io,
                    room.code,
                    result.gameState.sessionId,
                    result.gameState.state.roundId
                );
            } else {
                scheduleActionPhaseTimeout(
                    io,
                    room.code,
                    payload.sessionId,
                    payload.roundId,
                    "results"
                );
            }
            acknowledge(result.result);
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });
}

function scheduleSubmissionPhase(io, roomCode, sessionId, roundId) {
    clearActionPhaseTimeout(roomCode);
    const timer = setTimeout(() => {
        try {
            const result = gameManager.performGameAction(
                roomCode,
                "fake-answer",
                null,
                "open-submissions",
                { roundId },
                undefined,
                sessionId
            );
            io.to(roomCode).emit("game-state", result.gameState);
            scheduleActionPhaseTimeout(
                io,
                roomCode,
                sessionId,
                roundId,
                "answer-submission"
            );
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

function clearActionPhaseTimeout(roomCode, expectedSessionId) {
    const scheduled = actionPhaseTimeouts.get(roomCode);
    if (!scheduled || (
        expectedSessionId !== undefined &&
        scheduled.sessionId !== expectedSessionId
    )) {
        return false;
    }
    clearTimeout(scheduled.timer);
    actionPhaseTimeouts.delete(roomCode);
    return true;
}

function scheduleActionPhaseTimeout(io, roomCode, sessionId, roundId, phase) {
    const existing = actionPhaseTimeouts.get(roomCode);
    if (
        existing?.sessionId === sessionId &&
        existing.roundId === roundId &&
        existing.phase === phase
    ) {
        return;
    }
    clearActionPhaseTimeout(roomCode);
    const timer = setTimeout(() => {
        const current = actionPhaseTimeouts.get(roomCode);
        if (current?.timer !== timer) {
            return;
        }
        actionPhaseTimeouts.delete(roomCode);
        expireActionPhase(io, roomCode, sessionId, roundId, phase);
    }, ACTION_PHASE_TIMEOUT_MS);
    timer.unref();
    actionPhaseTimeouts.set(roomCode, {
        timer,
        sessionId,
        roundId,
        phase
    });
}

function expireActionPhase(io, roomCode, sessionId, roundId, expectedPhase) {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.status !== "starting" || room.players.length === 0) {
        return false;
    }

    let currentGame;
    try {
        currentGame = gameManager.getPublicGameState(roomCode, room.players[0].id);
    } catch (error) {
        if (
            error instanceof gameManager.GameSessionError &&
            ["GAME_NOT_ACTIVE", "NOT_A_GAME_PLAYER"].includes(error.code)
        ) {
            return false;
        }
        console.error("Could not inspect fake-answer phase before timeout:", error);
        return false;
    }
    if (
        currentGame.sessionId !== sessionId ||
        currentGame.state.roundId !== roundId ||
        currentGame.state.phase !== expectedPhase ||
        !gameManager.abortActiveGame(roomCode, sessionId)
    ) {
        return false;
    }

    try {
        roomManager.recoverRoomToLobby(room);
    } catch (error) {
        console.error("Could not recover room after fake-answer timeout:", error);
        return false;
    }
    io.to(roomCode).emit("lobby-state", roomManager.createLobbyState(room));
    io.to(roomCode).emit("game-aborted", {
        reason: "phase-timeout",
        message: "The game returned to the lobby because the round was not completed in time."
    });
    return true;
}

module.exports = {
    broadcastPlayerGameStates,
    clearActionPhaseTimeout,
    expireActionPhase,
    registerSocketHandlers,
    scheduleSubmissionPhase
};
