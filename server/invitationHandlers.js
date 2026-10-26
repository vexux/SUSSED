const roomManager = require("./roomManager");

const ERROR_MESSAGES = {
    AUTH_REQUIRED: "Sign in to use in-app game invitations.",
    INVALID_REQUEST: "The invitation request is invalid.",
    INVALID_TRANSITION: "This invitation is no longer available.",
    PROFILE_UNAVAILABLE: "Invitations are temporarily unavailable. Room play is unaffected.",
    ROOM_NOT_AVAILABLE: "This room is no longer available to join.",
    ROOM_FULL: "This room is full.",
    ALREADY_IN_ROOM: "You are already in a room.",
    DUPLICATE_PLAYER_NAME: "That name is already used in this room. Choose another name.",
    INVALID_PLAYER_NAME: "Choose a player name between 2 and 20 characters.",
    ROOM_NOT_FOUND: "This room is no longer available to join.",
};

function sendError(acknowledge, code, message = ERROR_MESSAGES[code]) {
    if (typeof acknowledge === "function") {
        acknowledge({ error: { code, message: message || ERROR_MESSAGES.PROFILE_UNAVAILABLE } });
    }
}

function registerInvitationHandlers(io, socket, profileRepository, reportFailure = () => {}) {
    async function authenticated(acknowledge, operation) {
        if (typeof acknowledge !== "function") return;
        const accountId = socket.data && socket.data.accountId;
        if (typeof accountId !== "string" || !accountId) {
            sendError(acknowledge, "AUTH_REQUIRED");
            return;
        }
        if (!profileRepository) {
            sendError(acknowledge, "PROFILE_UNAVAILABLE");
            return;
        }
        try {
            const response = await operation(accountId);
            if (response && response.error) {
                sendError(acknowledge, response.error.code, response.error.message);
            } else {
                acknowledge(response);
            }
        } catch (error) {
            const code = error && typeof error.code === "string" ? error.code : "PROFILE_UNAVAILABLE";
            if (code === "PROFILE_UNAVAILABLE") reportFailure(code);
            sendError(acknowledge, ERROR_MESSAGES[code] ? code : "PROFILE_UNAVAILABLE");
        }
    }

    socket.on("send-game-invitation", (payload, acknowledge) => {
        void authenticated(acknowledge, async (accountId) => {
            const room = roomManager.getPlayerRoom(socket.id);
            if (!room) return { error: { code: "ROOM_NOT_AVAILABLE", message: ERROR_MESSAGES.ROOM_NOT_AVAILABLE } };
            if (room.status !== "lobby") {
                return { error: { code: "ROOM_NOT_AVAILABLE", message: ERROR_MESSAGES.ROOM_NOT_AVAILABLE } };
            }
            if (room.players.length >= roomManager.createLobbyState(room).maxPlayers) {
                return { error: { code: "ROOM_FULL", message: ERROR_MESSAGES.ROOM_FULL } };
            }
            if (!payload || typeof payload !== "object" || typeof payload.handle !== "string") {
                return { error: { code: "INVALID_REQUEST", message: ERROR_MESSAGES.INVALID_REQUEST } };
            }
            const invitationId = await profileRepository.sendGameInvitation(
                accountId,
                payload.handle,
                room.code,
                room.publicRoomId,
            );
            return { invitationId };
        });
    });

    socket.on("decline-game-invitation", (payload, acknowledge) => {
        void authenticated(acknowledge, async (accountId) => {
            if (!payload || typeof payload !== "object" || typeof payload.invitationId !== "string") {
                return { error: { code: "INVALID_REQUEST", message: ERROR_MESSAGES.INVALID_REQUEST } };
            }
            await profileRepository.setGameInvitationStatus(accountId, payload.invitationId, "declined");
            return { ok: true };
        });
    });

    socket.on("accept-game-invitation", (payload, acknowledge) => {
        void authenticated(acknowledge, async (accountId) => {
            if (!payload || typeof payload !== "object" ||
                typeof payload.invitationId !== "string" ||
                typeof payload.playerName !== "string") {
                return { error: { code: "INVALID_REQUEST", message: ERROR_MESSAGES.INVALID_REQUEST } };
            }
            if (roomManager.getPlayerRoom(socket.id)) {
                return { error: { code: "ALREADY_IN_ROOM", message: ERROR_MESSAGES.ALREADY_IN_ROOM } };
            }
            const invitation = await profileRepository.getGameInvitation(accountId, payload.invitationId);
            if (!invitation || invitation.status !== "pending" || Date.parse(invitation.expiresAt) <= Date.now()) {
                return { error: { code: "INVALID_TRANSITION", message: ERROR_MESSAGES.INVALID_TRANSITION } };
            }
            const room = roomManager.getRoom(invitation.roomCode);
            if (!room || room.publicRoomId !== invitation.roomInstanceId || room.status !== "lobby") {
                return { error: { code: "ROOM_NOT_AVAILABLE", message: ERROR_MESSAGES.ROOM_NOT_AVAILABLE } };
            }
            if (room.players.length >= roomManager.createLobbyState(room).maxPlayers) {
                return { error: { code: "ROOM_FULL", message: ERROR_MESSAGES.ROOM_FULL } };
            }

            let joinedRoom;
            try {
                joinedRoom = roomManager.joinRoom(invitation.roomCode, socket.id, payload.playerName);
                await socket.join(joinedRoom.code);
                await profileRepository.setGameInvitationStatus(accountId, payload.invitationId, "accepted");
            } catch (error) {
                if (joinedRoom) {
                    roomManager.removePlayer(socket.id);
                    try {
                        await socket.leave(joinedRoom.code);
                    } catch (leaveError) {
                        reportFailure(leaveError);
                    }
                    io.to("public-room-browsers").emit("public-rooms-updated", {
                        rooms: roomManager.listPublicRooms(),
                    });
                }
                throw error;
            }

            const lobby = roomManager.createLobbyState(joinedRoom);
            for (const player of joinedRoom.players) {
                io.to(player.id).emit("lobby-state", lobby);
            }
            io.to("public-room-browsers").emit("public-rooms-updated", {
                rooms: roomManager.listPublicRooms(),
            });
            return { lobby };
        });
    });
}

module.exports = { registerInvitationHandlers };
