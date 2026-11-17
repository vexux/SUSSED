const { createServer } = require("node:http");
const { Server } = require("socket.io");
const {
    createDisabledSocketAuthMiddleware,
    createSocketAuthMiddleware,
    createFirebaseTokenVerifier,
} = require("./auth");
const { authEnabled: defaultAuthEnabled, isOriginAllowed, port: defaultPort } = require("./config");
const { registerProfileHandlers } = require("./profileHandlers");
const { createProfileRepository } = require("./profileRepository");
const { registerInvitationHandlers } = require("./invitationHandlers");
const { registerDisabledAccountHandlers } = require("./disabledAccountHandlers");
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
    {
        verifyAccessToken,
        profileRepository: injectedProfileRepository,
        authEnabled = defaultAuthEnabled,
    } = {},
) {
    if (typeof authEnabled !== "boolean") {
        throw new TypeError("authEnabled must be a boolean.");
    }
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

    if (authEnabled) {
        const tokenVerifier = verifyAccessToken ?? createFirebaseTokenVerifier();
        io.use(createSocketAuthMiddleware(tokenVerifier));
    } else {
        io.use(createDisabledSocketAuthMiddleware());
    }

    let profileRepository = authEnabled ? injectedProfileRepository ?? null : null;
    if (authEnabled && !injectedProfileRepository) {
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
        socket.emit("server-auth-config", { authEnabled });
        registerRoomHandlers(io, socket);
        if (authEnabled) {
            registerProfileHandlers(socket, profileRepository, (errorCode) => {
                console.error("Profile operation failed:", errorCode);
            });
            registerInvitationHandlers(io, socket, profileRepository, (errorCode) => {
                console.error("Invitation operation failed:", errorCode);
            });
        } else {
            registerDisabledAccountHandlers(socket);
        }

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