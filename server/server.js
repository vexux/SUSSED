const { Server } = require("socket.io");

const io = new Server(3000, {
    cors: {
        origin: "*"
    }
});

console.log("SUSSED! server running on port 3000");

io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("Player disconnected:", socket.id);
    });
});