const roomManager = require("./roomManager");

function registerRoomHandlers(socket) {
    socket.on("create-room", async (acknowledge) => {
        if (typeof acknowledge !== "function") {
            return;
        }

        let room;
        try {
            room = roomManager.createRoom(socket.id);
            await socket.join(room.code);
            acknowledge({ roomCode: room.code });
        } catch (error) {
            if (room) {
                roomManager.removeRoom(room.code);
            }
            console.error("Failed to create room:", error);
            acknowledge({ error: "Unable to create room." });
        }
    });
}

module.exports = { registerRoomHandlers };
