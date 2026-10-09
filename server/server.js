const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { isOriginAllowed, port: defaultPort } = require("./config");
const { handleDisconnect, registerRoomHandlers } = require("./roomHandlers");

function handleHttpRequest(request, response) {
    if (request.method === "GET" && request.url?.split("?")[0] === "/healthz") {
        response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ status: "ok" }));
        return;
    }

    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found" }));
}

function startServer(port = defaultPort) {
    const httpServer = createServer(handleHttpRequest);
    const io = new Server(httpServer, {
        cors: {
            origin(origin, callback) {
                if (isOriginAllowed(origin)) {
                    callback(null, true);
                    return;
                }
                callback(new Error("Origin is not allowed by server CORS configuration."));
            },
        }
    });

    io.on("connection", (socket) => {
        console.log("Player connected:", socket.id);
        registerRoomHandlers(io, socket);

        socket.on("disconnect", () => {
            console.log("Player disconnected:", socket.id);
            handleDisconnect(io, socket);
        });
    });

    httpServer.listen(port, () => {
        const address = httpServer.address();
        const listeningPort =
            address && typeof address === "object" ? address.port : port;
        console.log(`SUSSED! server running on port ${listeningPort}`);
    });

    return io;
}

if (require.main === module) {
    startServer();
}

module.exports = { startServer };