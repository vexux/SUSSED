const { Server } = require("socket.io");
const { port: defaultPort } = require("./config");
const { handleDisconnect, registerRoomHandlers } = require("./roomHandlers");

function startServer(port = defaultPort) {
    const io = new Server(port, {
        cors: {
            origin: "*"
        }
    });

    console.log(`SUSSED! server running on port ${port}`);

    io.on("connection", (socket) => {
        console.log("Player connected:", socket.id);
        registerRoomHandlers(io, socket);

        socket.on("disconnect", () => {
            console.log("Player disconnected:", socket.id);
            handleDisconnect(io, socket);
        });
    });

    return io;
}

if (require.main === module) {
    startServer();
}

module.exports = { startServer };