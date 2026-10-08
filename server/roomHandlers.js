const roomManager = require("./roomManager");

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

    console.error("Room operation failed:", error);
    return { code: "INTERNAL_ERROR", message: "The room operation could not be completed." };
}

function broadcastLobby(io, room) {
    io.to(room.code).emit("lobby-state", roomManager.createLobbyState(room));
}

function registerRoomHandlers(io, socket) {
    socket.on("create-room", async (payload, acknowledge) => {
        const isLegacyCall = typeof payload === "function";
        if (isLegacyCall) {
            acknowledge = payload;
            payload = undefined;
        }
        if (typeof acknowledge !== "function") {
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
        if (typeof acknowledge !== "function") {
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

    socket.on("leave-room", async (acknowledge) => {
        if (typeof acknowledge !== "function") {
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
        }
        acknowledge({ left: true });
    });
}

function handleDisconnect(io, socket) {
    const updatedRoom = roomManager.removePlayer(socket.id);
    socket.data.roomCode = undefined;
    if (updatedRoom) {
        broadcastLobby(io, updatedRoom);
    }
}

module.exports = { handleDisconnect, registerRoomHandlers };
