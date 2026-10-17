const roomManager = require("./roomManager");
const gameManager = require("./gameManager");
const fakeAnswerSocketHandlers = require("./games/fake-answer/socketHandlers");
const bruhWtfSocketHandlers = require("./games/bruh-wtf/socketHandlers");

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acknowledgeError(acknowledge, code, message) {
    if (typeof acknowledge === "function") {
        acknowledge({ error: { code, message } });
    }
}

function getOperationError(error) {
    if (error instanceof roomManager.RoomError) {
        return { code: error.code, message: error.message };
    }
    if (error instanceof gameManager.GameSessionError) {
        return { code: error.code, message: error.message };
    }

    console.error("Room operation failed:", error);
    return { code: "INTERNAL_ERROR", message: "The room operation could not be completed." };
}

function broadcastLobby(io, room, { resultsSessionId = null } = {}) {
    const lobby = roomManager.createLobbyState(room);
    const recipients = new Set(roomManager.getLobbyParticipants(room).map(({ id }) => id));
    if (resultsSessionId) {
        for (const id of roomManager.getResultsViewers(room, resultsSessionId)) recipients.add(id);
    }
    for (const playerId of recipients) {
        io.to(playerId).emit("lobby-state", lobby);
    }
}

async function handlePlayerDeparture(io, socket, { leaveSocket = false } = {}) {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) {
        socket.data.roomCode = undefined;
        return null;
    }

    const departure = gameManager.removeParticipant(room.code, socket.id);
    const updatedRoom = roomManager.removePlayer(socket.id);
    socket.data.roomCode = undefined;
    let leavePromise = Promise.resolve(null);
    if (leaveSocket) {
        try {
            leavePromise = Promise.resolve(socket.leave(room.code))
                .then(() => null, (error) => getOperationError(error));
        } catch (error) {
            leavePromise = Promise.resolve(getOperationError(error));
        }
    }

    if (!updatedRoom) {
        gameManager.removeGame(room.code, departure?.sessionId);
        return { room, updatedRoom: null, departure, leaveError: await leavePromise };
    }

    if (departure?.removed && updatedRoom.players.length <= 1) {
        gameManager.removeGame(room.code, departure.sessionId);
        roomManager.recoverRoomToLobby(updatedRoom);
        broadcastLobby(io, updatedRoom);
    } else if (departure?.removed) {
        if (departure.needsVoting && departure.gameId.startsWith("fact-or-cap")) {
            // Fact-or-Cap intentionally routes completed submissions through
            // its reveal phase before voting. Reconcile that phase before the
            // departure broadcast so clients never receive an obsolete reveal.
            gameManager.performGameAction(
                room.code,
                departure.gameId,
                null,
                "begin-voting",
                undefined,
                undefined,
                departure.sessionId
            );
        }
        for (const player of departure.players) {
            io.to(player.id).emit("game-state", gameManager.getPublicGameState(room.code, player.id));
        }
        if (departure.advancedRound && departure.gameId.startsWith("fact-or-cap")) {
            const current = gameManager.getPublicGameState(room.code, departure.players[0].id);
            fakeAnswerSocketHandlers.scheduleSubmissionPhase(
                io,
                room.code,
                departure.sessionId,
                current.state.roundId,
                departure.gameId
            );
        }
    } else {
        broadcastLobby(io, updatedRoom);
    }
    return { room, updatedRoom, departure, leaveError: await leavePromise };
}

function isAcknowledgement(value) {
    return typeof value === "function";
}

function registerRoomHandlers(io, socket) {
    fakeAnswerSocketHandlers.registerSocketHandlers(io, socket);
    bruhWtfSocketHandlers.registerSocketHandlers(io, socket);

    socket.on("create-room", async (payload, acknowledge) => {
        const isLegacyCall = typeof payload === "function";
        if (isLegacyCall) {
            acknowledge = payload;
            payload = undefined;
        }
        if (!isAcknowledgement(acknowledge)) {
            return;
        }
        if (roomManager.getPlayerRoom(socket.id)) {
            acknowledgeError(acknowledge, "ALREADY_IN_ROOM", "You are already in a room.");
            return;
        }

        const playerName = isLegacyCall
            ? "Player"
            : isRecord(payload)
              ? payload.playerName
              : undefined;

        let room;
        try {
            room = roomManager.createRoom(socket.id, playerName);
            await socket.join(room.code);
        } catch (error) {
            if (room) {
                roomManager.removeRoom(room.code);
            }
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
            return;
        }

        socket.data.roomCode = room.code;
        broadcastLobby(io, room);
        acknowledge({ roomCode: room.code });
    });

    socket.on("join-room", async (payload, acknowledge) => {
        if (!isAcknowledgement(acknowledge)) {
            return;
        }
        if (!isRecord(payload)) {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "Room code and player name are required.");
            return;
        }
        if (roomManager.getPlayerRoom(socket.id)) {
            acknowledgeError(acknowledge, "ALREADY_IN_ROOM", "You are already in a room.");
            return;
        }

        let room;
        try {
            room = roomManager.joinRoom(
                payload.roomCode,
                socket.id,
                payload.playerName
            );
            await socket.join(room.code);
        } catch (error) {
            if (room) {
                roomManager.removePlayer(socket.id);
            }
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
            return;
        }

        socket.data.roomCode = room.code;
        const lobby = roomManager.createLobbyState(room);
        broadcastLobby(io, room);
        acknowledge({ lobby });
    });

    socket.on("leave-room", async (payload, acknowledge) => {
        const hasPayload = typeof payload !== "function";
        if (!hasPayload) {
            acknowledge = payload;
        }
        if (!isAcknowledgement(acknowledge)) {
            return;
        }
        if (hasPayload) {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "Leave room does not accept a payload.");
            return;
        }
        const room = roomManager.getPlayerRoom(socket.id);
        if (!room) {
            socket.data.roomCode = undefined;
            acknowledgeError(acknowledge, "NOT_IN_ROOM", "You are not in a room.");
            return;
        }

        const result = await handlePlayerDeparture(io, socket, { leaveSocket: true });
        if (result?.leaveError) {
            acknowledgeError(acknowledge, result.leaveError.code, result.leaveError.message);
            return;
        }
        acknowledge({ left: true });
    });

    socket.on("set-ready", (payload, acknowledge) => {
        if (!isAcknowledgement(acknowledge)) {
            return;
        }
        if (!isRecord(payload) || typeof payload.isReady !== "boolean") {
            acknowledgeError(
                acknowledge,
                "INVALID_REQUEST",
                "A boolean isReady value is required."
            );
            return;
        }

        try {
            const room = roomManager.setPlayerReady(socket.id, payload.isReady);
            broadcastLobby(io, room);
            acknowledge({ isReady: payload.isReady });
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });

    socket.on("select-game", (payload, acknowledge) => {
        if (!isAcknowledgement(acknowledge)) {
            return;
        }
        if (
            !isRecord(payload) ||
            Object.keys(payload).length !== 1 ||
            typeof payload.gameId !== "string"
        ) {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "A registered gameId is required.");
            return;
        }

        try {
            const room = roomManager.selectGame(socket.id, payload.gameId);
            broadcastLobby(io, room);
            acknowledge({
                selectedGameId: room.selectedGameId,
                lobby: roomManager.createLobbyState(room)
            });
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });

    socket.on("select-round-count", (payload, acknowledge) => {
        if (!isAcknowledgement(acknowledge)) {
            return;
        }
        if (
            !isRecord(payload) ||
            Object.keys(payload).length !== 2 ||
            !Object.hasOwn(payload, "roundCount") ||
            !Object.hasOwn(payload, "revision")
        ) {
            acknowledgeError(
                acknowledge,
                "INVALID_REQUEST",
                "A roundCount and current lobby revision are required."
            );
            return;
        }

        try {
            const room = roomManager.selectRoundCount(
                socket.id,
                payload.roundCount,
                payload.revision
            );
            const lobby = roomManager.createLobbyState(room);
            broadcastLobby(io, room);
            acknowledge({ selectedRoundCount: room.selectedRoundCount, lobby });
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });

    socket.on("start-game", (payload, acknowledge) => {
        const hasPayload = typeof payload !== "function";
        if (!hasPayload) {
            acknowledge = payload;
        }
        if (!isAcknowledgement(acknowledge)) {
            return;
        }
        if (hasPayload) {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "Start game does not accept a payload.");
            return;
        }

        let startingRoom;
        try {
            const room = roomManager.validateRoomStart(socket.id);
            const eligibleRoom = roomManager.createGameStartRoom(room);
            const selectedGame = gameManager.validateGameStart(eligibleRoom, room.selectedGameId);
            startingRoom = roomManager.startRoom(socket.id);
            const lobby = roomManager.createLobbyState(startingRoom);
            const gameRoom = roomManager.createGameStartRoom(startingRoom);
            const game = gameManager.startGame(gameRoom, startingRoom.selectedGameId);
            for (const player of game.players) {
                io.to(player.id).emit("game-starting", { roomCode: startingRoom.code, lobby, game });
                io.to(player.id).emit("game-state", gameManager.getPublicGameState(startingRoom.code, player.id));
            }
            if (selectedGame.socketProtocol === "fake-answer") {
                fakeAnswerSocketHandlers.scheduleSubmissionPhase(
                    io,
                    startingRoom.code,
                    game.sessionId,
                    game.state.roundId,
                    startingRoom.selectedGameId
                );
            }
            acknowledge({ starting: true, game });
        } catch (error) {
            if (startingRoom) {
                gameManager.abortActiveGame(startingRoom.code);
                roomManager.cancelRoomStart(startingRoom);
            }
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });

    socket.on("return-to-lobby", (payload, acknowledge) => {
        if (!isAcknowledgement(acknowledge)) {
            return;
        }

        try {
            if (
                !isRecord(payload) ||
                Object.keys(payload).length !== 1 ||
                typeof payload.sessionId !== "string"
            ) {
                acknowledgeError(
                    acknowledge,
                    "INVALID_REQUEST",
                    "The finished game sessionId is required."
                );
                return;
            }
            const room = roomManager.validateReturnToLobby(socket.id);
            const snapshot = gameManager.retireFinishedGame(room.code, payload.sessionId);
            const lobbyRoom = roomManager.returnToLobby(socket.id, payload.sessionId, snapshot);
            // Results viewers need the authoritative room update to know the
            // host has returned, while retaining their local finished snapshot.
            broadcastLobby(io, lobbyRoom, { resultsSessionId: payload.sessionId });
            acknowledge({ returned: true });
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });

    socket.on("ask-results-viewers-to-return", (payload, acknowledge) => {
        if (!isAcknowledgement(acknowledge)) return;
        if (!isRecord(payload) || Object.keys(payload).length !== 1 || typeof payload.sessionId !== "string") {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "A finished sessionId is required.");
            return;
        }
        const room = roomManager.getPlayerRoom(socket.id);
        if (!room) return acknowledgeError(acknowledge, "NOT_IN_ROOM", "You are not in a room.");
        if (room.hostId !== socket.id) return acknowledgeError(acknowledge, "NOT_HOST", "Only the host can send this reminder.");
        const match = roomManager.getFinishedMatch(room, payload.sessionId);
        if (!match || room.reminderSessionId !== payload.sessionId) {
            return acknowledgeError(acknowledge, "SESSION_MISMATCH", "Those completed results are no longer available.");
        }
        const viewers = roomManager.getResultsViewers(room, payload.sessionId);
        for (const playerId of viewers) {
            io.to(playerId).emit("results-return-reminder", { sessionId: payload.sessionId });
        }
        acknowledge({ sent: viewers.length });
    });

    socket.on("return-from-results", (payload, acknowledge) => {
        if (!isAcknowledgement(acknowledge)) return;
        if (!isRecord(payload) || Object.keys(payload).length !== 1 || typeof payload.sessionId !== "string") {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "A finished sessionId is required.");
            return;
        }
        try {
            const room = roomManager.returnResultsViewer(socket.id, payload.sessionId);
            if (room.status === "lobby") {
                broadcastLobby(io, room);
            } else {
                io.to(socket.id).emit("lobby-state", roomManager.createLobbyState(room));
            }
            acknowledge({ returned: true, status: room.status });
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });
}

function handleDisconnect(io, socket) {
    void handlePlayerDeparture(io, socket);
}

module.exports = { handleDisconnect, registerRoomHandlers };
