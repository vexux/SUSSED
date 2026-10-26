const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { createSocketAuthMiddleware, createFirebaseTokenVerifier } = require("./auth");
const { isOriginAllowed, port: defaultPort } = require("./config");
const { registerProfileHandlers } = require("./profileHandlers");
const { createProfileRepository } = require("./profileRepository");
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

function startServer(
    port = defaultPort,
    { verifyAccessToken, profileRepository: injectedProfileRepository } = {},
) {
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

    const tokenVerifier = verifyAccessToken ?? createFirebaseTokenVerifier();
    io.use(createSocketAuthMiddleware(tokenVerifier));

    let profileRepository = injectedProfileRepository ?? null;
    if (!injectedProfileRepository) {
        try {
            profileRepository = createProfileRepository();
        } catch (error) {
            const message =
                error && typeof error.message === "string"
                    ? error.message
                    : "Unknown profile repository configuration error.";
            console.error("Profile repository is unavailable:", message);
        }
    }

    io.on("connection", (socket) => {
        console.log("Player connected:", socket.id);
        registerRoomHandlers(io, socket);
        registerProfileHandlers(socket, profileRepository, (errorCode) => {
            console.error("Profile operation failed:", errorCode);
        });

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