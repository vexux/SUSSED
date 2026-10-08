const roomManager = require("./roomManager");
const gameManager = require("./gameManager");
const fakeAnswerSocketHandlers = require("./games/fake-answer/socketHandlers");
const DEFAULT_GAME_ID = "fake-answer";

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

function broadcastLobby(io, room) {
    io.to(room.code).emit("lobby-state", roomManager.createLobbyState(room));
}

function isAcknowledgement(value) {
    return typeof value === "function";
}

function registerRoomHandlers(io, socket) {
    fakeAnswerSocketHandlers.registerSocketHandlers(io, socket);

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

        try {
            await socket.leave(room.code);
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
            return;
        }

        socket.data.roomCode = undefined;
        const updatedRoom = roomManager.removePlayer(socket.id);
        if (updatedRoom) {
            broadcastLobby(io, updatedRoom);
        } else {
            gameManager.removeGame(room.code);
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

    socket.on("start-game", (payload, acknowledge) => {
        const hasPayload = typeof payload !== "function";
        if (!hasPayload) {
            acknowledge = payload;
        }
        if (!isAcknowledgement(acknowledge)) {
            return;
        }
        const gameId = hasPayload
            ? isRecord(payload) &&
              Object.keys(payload).length === 1 &&
              typeof payload.gameId === "string"
                ? payload.gameId
                : null
            : DEFAULT_GAME_ID;
        if (gameId === null) {
            acknowledgeError(acknowledge, "INVALID_REQUEST", "A registered gameId is required.");
            return;
        }

        try {
            const room = roomManager.validateRoomStart(socket.id);
            gameManager.validateGameStart(room, gameId);
            const startingRoom = roomManager.startRoom(socket.id);
            const lobby = roomManager.createLobbyState(startingRoom);
            const game = gameManager.startGame(startingRoom, gameId);
            io.to(startingRoom.code).emit("game-starting", {
                roomCode: startingRoom.code,
                lobby
            });
            io.to(startingRoom.code).emit("game-state", game);
            if (gameId === DEFAULT_GAME_ID) {
                fakeAnswerSocketHandlers.scheduleSubmissionPhase(io, startingRoom.code);
            }
            acknowledge({ starting: true });
        } catch (error) {
            const operationError = getOperationError(error);
            acknowledgeError(acknowledge, operationError.code, operationError.message);
        }
    });
}

function handleDisconnect(io, socket) {
    const room = roomManager.getPlayerRoom(socket.id);
    const updatedRoom = roomManager.removePlayer(socket.id);
    socket.data.roomCode = undefined;
    if (updatedRoom) {
        broadcastLobby(io, updatedRoom);
    } else if (room) {
        gameManager.removeGame(room.code);
    }
}

module.exports = { DEFAULT_GAME_ID, handleDisconnect, registerRoomHandlers };
