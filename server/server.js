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
const { DisconnectGraceManager } = require("./disconnectGraceManager");
const {
    GuestIdentityManager,
    createSocketIdentityMiddleware,
    getPersonalRoomName,
} = require("./guestIdentityManager");
const {
    handleDisconnect,
    handlePlayerReconnect,
    registerRoomHandlers
} = require("./roomHandlers");

const SESSION_STORAGE_ACK_TIMEOUT_MS = 10000;

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
        identityManager = new GuestIdentityManager(),
        disconnectGraceManager = new DisconnectGraceManager(),
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
    io.use(createSocketIdentityMiddleware(identityManager));

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

    io.guestIdentityManager = identityManager;
    io.disconnectGraceManager = disconnectGraceManager;
    httpServer.once("close", () => disconnectGraceManager.cancelAll());
    io.on("connection", (socket) => {
        console.log("Player connected:", socket.id);
        socket.data.sessionReady = false;
        socket.use((_packet, next) => {
            if (socket.data.sessionReady !== true) {
                const error = new Error("The guest session is not ready.");
                error.data = { code: "SESSION_NOT_READY" };
                next(error);
                return;
            }
            if (!identityManager.isActiveSocket(socket.data.playerId, socket.id)) {
                const error = new Error("The guest session is no longer active on this connection.");
                error.data = { code: "SESSION_NOT_ACTIVE" };
                next(error);
                return;
            }
            next();
        });
        socket.on("disconnect", () => {
            console.log("Player disconnected:", socket.id);
            handleDisconnect(io, socket, identityManager, disconnectGraceManager);
        });

        void activateGuestSession(
            io,
            socket,
            identityManager,
            disconnectGraceManager,
            authEnabled,
            profileRepository
        );
    });

    httpServer.listen(port, () => {
        const address = httpServer.address();
        const listeningPort =
            address && typeof address === "object" ? address.port : port;
        console.log(`SUSSED! server running on port ${listeningPort}`);
    });

    return io;
}

async function activateGuestSession(
    io,
    socket,
    identityManager,
    disconnectGraceManager,
    authEnabled,
    profileRepository
) {
    const playerId = socket.data.playerId;
    const recoveryCredential = socket.data.pendingRecoveryCredential;
    try {
        await socket.join(getPersonalRoomName(playerId));
        const stored = await requestCredentialStorageAcknowledgement(socket, {
            playerId,
            recoveryCredential,
            rotated: socket.data.recoveryCredentialRotated === true,
        });
        if (socket.disconnected) {
            identityManager.abortSocket(socket.id);
            return;
        }
        if (stored !== true) {
            identityManager.abortSocket(socket.id);
            socket.data.pendingRecoveryCredential = undefined;
            socket.emit("guest-session-error", {
                code: "RECOVERY_STORAGE_UNAVAILABLE",
                message: "The guest recovery credential could not be stored in this tab.",
            });
            socket.disconnect(true);
            return;
        }

        const activatedPlayerId = identityManager.activateSocket(socket.id, true);
        socket.data.playerId = activatedPlayerId;
        socket.data.sessionReady = true;
        socket.data.pendingRecoveryCredential = undefined;
        socket.data.recoveryCredentialRotated = undefined;
        registerRoomHandlers(io, socket, identityManager, disconnectGraceManager);
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
        socket.emit("server-auth-config", { authEnabled });
        socket.emit("guest-session-ready", { playerId: activatedPlayerId });
        if (identityManager.isActiveSocket(activatedPlayerId, socket.id)) {
            handlePlayerReconnect(io, activatedPlayerId, disconnectGraceManager);
        }
    } catch (error) {
        identityManager.abortSocket(socket.id);
        socket.data.pendingRecoveryCredential = undefined;
        if (!socket.disconnected) {
            const code = error && typeof error.code === "string"
                ? error.code
                : "RECOVERY_INTERNAL_ERROR";
            socket.emit("guest-session-error", {
                code,
                message: "The guest session could not be activated. Reconnect and try again.",
            });
            socket.disconnect(true);
        }
    }
}

function requestCredentialStorageAcknowledgement(socket, session) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (stored) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(stored === true);
        };
        const timeout = setTimeout(() => finish(false), SESSION_STORAGE_ACK_TIMEOUT_MS);
        timeout.unref();
        socket.emit("guest-session-issued", session, (acknowledgement) => {
            finish(
                acknowledgement &&
                typeof acknowledgement === "object" &&
                acknowledgement.stored === true,
            );
        });
        socket.once("disconnect", () => finish(false));
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { startServer };