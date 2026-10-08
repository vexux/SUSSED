const { Server } = require("socket.io");
const roomManager = require("./roomManager");

const io = new Server(3000, {
    cors: {
        origin: "*"
    }
});

console.log("SUSSED! server running on port 3000");

io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

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

    socket.on("disconnect", () => {
        console.log("Player disconnected:", socket.id);
    });
});