const assert = require("node:assert/strict");
const test = require("node:test");
const { io: createClient } = require("socket.io-client");
const { port: defaultPort } = require("../config");
const gameManager = require("../gameManager");
const factOrCapGame = require("../games/fact-or-cap/game");
const { questions } = require("../games/fact-or-cap/questionBank");
const { questions: animeQuestions } = require("../games/fact-or-cap/animeQuestionBank");
const factOrCapSocketHandlers = require("../games/fact-or-cap/socketHandlers");
const roomManager = require("../roomManager");
const {
    ACHIEVEMENT_EVENT_TYPES,
    createAchievementEvent
} = require("../achievementEvents");
const { startServer } = require("../server");
const { handleDisconnect } = require("../roomHandlers");
const { DisconnectGraceManager, DISCONNECT_GRACE_PERIOD_MS } = require("../disconnectGraceManager");
const { GuestIdentityManager, getPersonalRoomName } = require("../guestIdentityManager");
const { DISABLED_ACCOUNT_EVENTS } = require("../disabledAccountHandlers");
const { FakeScheduler } = require("./fakeScheduler");

const CURRENT_RECOVERY_KEY = "sussed:guest-recovery:v1";
const PENDING_RECOVERY_KEY = "sussed:guest-recovery:v1:pending";

function createMemoryStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
    };
}

function exposeStablePlayerId(client) {
    client.playerId = null;
    return new Proxy(client, {
        get(target, property) {
            if (property === "transportId") return target.id;
            if (property === "id") return target.playerId;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

test("achievement lifecycle events are validated, immutable, and contain no client identity", () => {
    const event = createAchievementEvent(ACHIEVEMENT_EVENT_TYPES.ROUND_COMPLETED, {
        roomCode: "ABCD",
        sessionId: "session-1",
        gameId: "fact-or-cap",
        occurredAt: "2025-01-01T00:00:00.000Z",
        round: 2
    });
    assert.deepEqual(event, {
        type: "game.round-completed",
        roomCode: "ABCD",
        sessionId: "session-1",
        gameId: "fact-or-cap",
        occurredAt: "2025-01-01T00:00:00.000Z",
        round: 2
    });
    assert.equal(Object.isFrozen(event), true);
    assert.throws(() => createAchievementEvent("game.unlocked", {
        roomCode: "ABCD",
        sessionId: "session-1",
        gameId: "fact-or-cap"
    }), /Unsupported achievement event type/u);
    assert.throws(() => createAchievementEvent(ACHIEVEMENT_EVENT_TYPES.ROUND_COMPLETED, {
        roomCode: "ABCD",
        sessionId: "session-1",
        gameId: "fact-or-cap",
        round: 0
    }), /positive round number/u);
    assert.equal("accountId" in event, false);
    assert.equal("playerId" in event, false);
});

function collectPublicKeysAndStringValues(value, keys = [], stringValues = []) {
    if (Array.isArray(value)) {
        value.forEach((item) => collectPublicKeysAndStringValues(item, keys, stringValues));
    } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
            keys.push(key);
            collectPublicKeysAndStringValues(child, keys, stringValues);
        }
    } else if (typeof value === "string") {
        stringValues.push(value);
    }
    return { keys, stringValues };
}

function assertQuestionPrivateDataAbsent(publicState, question) {
    const { keys, stringValues } = collectPublicKeysAndStringValues(publicState);
    for (const field of ["correctCompletion", "sourceName", "sourceUrl"]) {
        assert.equal(keys.includes(field), false, `public payload must not expose ${field}`);
    }
    for (const privateValue of [
        question.correctCompletion,
        question.sourceName,
        question.sourceUrl
    ]) {
        assert.equal(
            stringValues.includes(privateValue),
            false,
            "public payload must not expose private content as a complete value"
        );
    }
}

test("private-answer checks allow answer text already present in the public prompt", () => {
    const question = questions.find(({ id }) => id === "moon-synchronous-rotation");
    assert.ok(question);
    assert.equal(question.correctCompletion, "Earth");
    assert.ok(question.text.includes(question.correctCompletion));

    const publicState = {
        state: {
            phase: "question",
            prompt: { text: question.text }
        }
    };
    assertQuestionPrivateDataAbsent(publicState, question);
    assert.throws(
        () => assertQuestionPrivateDataAbsent({
            ...publicState,
            state: { ...publicState.state, answer: question.correctCompletion }
        }, question),
        assert.AssertionError
    );
});

test("Socket.IO polling allows the deployed frontend origins and rejects unlisted origins", async (context) => {
    const harness = await createHarness(context);
    const address = harness.io.httpServer.address();
    assert.ok(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`;

    for (const origin of ["https://getsussed.vercel.app"]) {
        const response = await fetch(endpoint, { headers: { origin } });
        assert.equal(response.status, 200, `${origin} should complete Socket.IO polling`);
        assert.equal(response.headers.get("access-control-allow-origin"), origin);
        await response.text();
    }

    for (const origin of ["https://sussed-sigma.vercel.app", "https://attacker.example"]) {
        const rejected = await fetch(endpoint, { headers: { origin } });
        assert.equal(rejected.status, 400, `${origin} should be rejected`);
        assert.equal(rejected.headers.has("access-control-allow-origin"), false);
        await rejected.text();
    }
});

async function createHarness(context, {
    verifyAccessToken,
    profileRepository,
    authEnabled = true,
} = {}) {
    const identityManager = new GuestIdentityManager();
    const scheduler = new FakeScheduler();
    const disconnectGraceManager = new DisconnectGraceManager({
        now: () => scheduler.time,
        setTimeoutFn: scheduler.setTimeout.bind(scheduler),
        clearTimeoutFn: scheduler.clearTimeout.bind(scheduler)
    });
    const io = startServer(0, {
        verifyAccessToken,
        profileRepository,
        authEnabled,
        identityManager,
        disconnectGraceManager
    });
    const clients = [];
    const roomCodes = new Set();

    await new Promise((resolve, reject) => {
        io.httpServer.once("listening", resolve);
        io.httpServer.once("error", reject);
    });

    const address = io.httpServer.address();
    assert.ok(address && typeof address === "object");
    assert.ok(address.port > 0);

    context.after(async () => {
        for (const client of clients) {
            client.close();
        }
        await new Promise((resolve) => io.close(resolve));
        for (const roomCode of roomCodes) {
            roomManager.removeRoom(roomCode);
            gameManager.removeGame(roomCode);
        }
    });

    return {
        io,
        async advanceGrace(milliseconds = DISCONNECT_GRACE_PERIOD_MS) {
            scheduler.advanceBy(milliseconds);
            await new Promise((resolve) => setImmediate(resolve));
        },
        async connect({ auth, onServerConfiguration, storage = createMemoryStorage() } = {}) {
            const socketClient = createClient(`http://127.0.0.1:${address.port}`, {
                autoConnect: false,
                auth: (callback) => {
                    const recoveryCredential =
                        storage.getItem(PENDING_RECOVERY_KEY) ??
                        storage.getItem(CURRENT_RECOVERY_KEY);
                    callback({
                        ...(auth && typeof auth === "object" ? auth : {}),
                        ...(recoveryCredential ? { recoveryCredential } : {}),
                    });
                },
                reconnection: false,
                timeout: 3000,
            });
            const client = exposeStablePlayerId(socketClient);
            client.recoveryStorage = storage;
            clients.push(client);
            client.on("guest-session-issued", (session, acknowledge) => {
                storage.setItem(PENDING_RECOVERY_KEY, session.recoveryCredential);
                acknowledge({ stored: true });
            });
            client.on("guest-session-ready", (session) => {
                client.playerId = session.playerId;
                const pending = storage.getItem(PENDING_RECOVERY_KEY);
                if (pending) {
                    storage.setItem(CURRENT_RECOVERY_KEY, pending);
                    storage.removeItem(PENDING_RECOVERY_KEY);
                }
            });
            if (onServerConfiguration) {
                client.on("server-auth-config", onServerConfiguration);
            }
            await new Promise((resolve, reject) => {
                const onReady = (session) => {
                    client.playerId = session.playerId;
                    client.off("connect_error", onError);
                    resolve();
                };
                const onError = (error) => {
                    client.off("guest-session-ready", onReady);
                    reject(error);
                };
                client.once("guest-session-ready", onReady);
                client.once("connect_error", onError);
                client.connect();
            });
            return client;
        },
        trackRoom(roomCode) {
            roomCodes.add(roomCode);
        },
    };
}

test("disabled auth skips account services while guest room gameplay stays available", async (context) => {
    let profileRepositoryCalls = 0;
    const harness = await createHarness(context, {
        authEnabled: false,
        profileRepository: {
            async getOrCreateProfile() {
                profileRepositoryCalls += 1;
                throw new Error("disabled services must not run");
            },
        },
    });
    let serverConfiguration;
    const guest = await harness.connect({
        onServerConfiguration: (configuration) => {
            serverConfiguration = configuration;
        },
    });
    const serverSocket = harness.io.sockets.sockets.get(guest.transportId);
    assert.ok(serverSocket);
    assert.equal(serverSocket.data.accountId, undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(serverConfiguration, { authEnabled: false });

    for (const eventName of DISABLED_ACCOUNT_EVENTS) {
        const response = await emitWithAck(guest, eventName, undefined);
        assert.equal(response.error.code, "AUTH_DISABLED", `${eventName} must be disabled`);
    }
    assert.equal(profileRepositoryCalls, 0);

    const games = await emitWithAck(guest, "list-games", undefined);
    assert.ok(games.games.length > 0);
    const created = await emitWithAck(guest, "create-room", { playerName: "Guest" });
    harness.trackRoom(created.roomCode);
    assert.equal(roomManager.getRoom(created.roomCode).hostId, guest.id);

    await assert.rejects(
        harness.connect({ auth: { accessToken: "attempted-token" } }),
        (error) => error.data?.code === "AUTH_DISABLED",
    );
});

test("guest sockets use a stable server-issued player identity", async (context) => {
    let profileRepositoryCalls = 0;
    const harness = await createHarness(context, {
        profileRepository: {
            async getOrCreateProfile() {
                profileRepositoryCalls += 1;
                throw new Error("guest must not request profiles");
            },
            async updateDisplayName() {
                profileRepositoryCalls += 1;
                throw new Error("guest must not request profiles");
            },
        },
    });
    const guest = await harness.connect();
    const serverSocket = harness.io.sockets.sockets.get(guest.transportId);
    assert.ok(serverSocket);
    assert.equal(serverSocket.data.playerId, guest.id);
    assert.notEqual(serverSocket.data.playerId, serverSocket.id);
    assert.equal(serverSocket.data.accountId, undefined);

    const profileResponse = await new Promise((resolve) => {
        guest.emit("get-profile", resolve);
    });
    assert.equal(profileResponse.error.code, "AUTH_REQUIRED");
    assert.equal(profileRepositoryCalls, 0);

    const created = await emitWithAck(guest, "create-room", {
        playerName: "Guest",
    });
    harness.trackRoom(created.roomCode);
    assert.equal(roomManager.getRoom(created.roomCode).hostId, guest.id);
});

test("recovery restores a disconnected room member and cancels its grace timer", async (context) => {
    const harness = await createHarness(context);
    const original = await harness.connect();
    const originalPlayerId = original.id;
    const originalCredential = original.recoveryStorage.getItem(CURRENT_RECOVERY_KEY);
    const originalServerSocket = harness.io.sockets.sockets.get(original.transportId);
    assert.ok(originalServerSocket.rooms.has(getPersonalRoomName(originalPlayerId)));

    const created = await emitWithAck(original, "create-room", { playerName: "Original" });
    const observer = await harness.connect();
    await emitWithAck(observer, "join-room", { roomCode: created.roomCode, playerName: "Observer" });
    harness.trackRoom(created.roomCode);

    const disconnectedLobbyPromise = waitForLobby(observer, (lobby) =>
        lobby.playerCount === 2 &&
        lobby.players.some(({ id, connected }) => id === originalPlayerId && connected === false)
    );
    const serverDisconnect = new Promise((resolve) => originalServerSocket.once("disconnect", resolve));
    original.disconnect();
    await serverDisconnect;
    const disconnectedLobby = await disconnectedLobbyPromise;
    assert.equal(disconnectedLobby.players.find(({ id }) => id === originalPlayerId).isHost, true);
    assert.equal(roomManager.getRoom(created.roomCode).players.length, 2);
    assert.equal(harness.io.disconnectGraceManager.size, 1);
    await harness.advanceGrace(DISCONNECT_GRACE_PERIOD_MS - 1);

    const restoredLobbyPromise = waitForLobby(observer, (lobby) =>
        lobby.playerCount === 2 &&
        !lobby.players.some(({ id, connected }) => id === originalPlayerId && connected === false)
    );
    const recovered = await harness.connect({ storage: original.recoveryStorage });
    assert.equal(recovered.id, originalPlayerId);
    assert.notEqual(recovered.transportId, original.transportId);
    const rotatedCredential = recovered.recoveryStorage.getItem(CURRENT_RECOVERY_KEY);
    assert.notEqual(rotatedCredential, originalCredential);
    assert.ok(
        harness.io.sockets.sockets.get(recovered.transportId).rooms.has(
            getPersonalRoomName(originalPlayerId),
        ),
    );
    assert.throws(
        () => harness.io.guestIdentityManager.beginRecovery("replay", originalCredential),
        { code: "RECOVERY_REPLAYED" },
    );
    assert.equal(harness.io.disconnectGraceManager.size, 0);
    await harness.advanceGrace(1);

    const restoredLobby = await restoredLobbyPromise;
    assert.equal(restoredLobby.players.find(({ id }) => id === originalPlayerId).isHost, true);
    handleDisconnect(
        harness.io,
        originalServerSocket,
        harness.io.guestIdentityManager,
        harness.io.disconnectGraceManager
    );
    assert.equal(harness.io.disconnectGraceManager.size, 0);
    const stalePacketError = await new Promise((resolve) => {
        originalServerSocket.run(["set-ready", { isReady: false }], resolve);
    });
    assert.equal(stalePacketError?.data?.code, "SESSION_NOT_ACTIVE");

    let receivedPrivateEvent = false;
    recovered.once("private-player-test", () => {
        receivedPrivateEvent = true;
    });
    harness.io.to(getPersonalRoomName(originalPlayerId)).emit("private-player-test");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(receivedPrivateEvent, true);

    assert.equal(roomManager.getPlayerRoom(originalPlayerId).code, created.roomCode);
    assert.equal((await emitWithAck(recovered, "create-room", { playerName: "Recovered" })).error.code, "ALREADY_IN_ROOM");
});

test("a second active connection cannot take over a recovered guest identity", async (context) => {
    const harness = await createHarness(context);
    const original = await harness.connect();
    await assert.rejects(
        harness.connect({ storage: original.recoveryStorage }),
        (error) => error.data?.code === "PLAYER_ALREADY_CONNECTED",
    );
    assert.equal(
        harness.io.guestIdentityManager.getSocketId(original.id),
        original.transportId,
    );
});

test("room operations are unavailable until recovery credentials are acknowledged as stored", async (context) => {
    const harness = await createHarness(context);
    const address = harness.io.httpServer.address();
    let createRoomCalls = 0;
    const originalCreateRoom = roomManager.createRoom;
    roomManager.createRoom = (...args) => {
        createRoomCalls += 1;
        return originalCreateRoom(...args);
    };
    context.after(() => {
        roomManager.createRoom = originalCreateRoom;
    });

    const client = createClient(`http://127.0.0.1:${address.port}`, {
        autoConnect: false,
        auth: {},
        reconnection: false,
    });
    context.after(() => client.close());
    client.on("guest-session-issued", (_session, acknowledge) => {
        client.emit("create-room", { playerName: "Too early" }, () => {});
        acknowledge({ stored: false });
    });
    const sessionError = new Promise((resolve, reject) => {
        client.once("guest-session-error", resolve);
        client.once("connect_error", reject);
    });
    client.connect();
    const failure = await sessionError;
    assert.equal(failure.code, "RECOVERY_STORAGE_UNAVAILABLE");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(createRoomCalls, 0);
    assert.equal(harness.io.guestIdentityManager.records.size, 0);
    client.close();
});

test("valid access tokens attach the verified account UID without changing player IDs", async (context) => {
    const accountId = "firebase-user-123";
    let verifiedToken;
    const harness = await createHarness(context, {
        verifyAccessToken: async (token) => {
            verifiedToken = token;
            return accountId;
        },
    });
    const authenticated = await harness.connect({
        auth: { accessToken: "valid-access-token" },
    });
    const serverSocket = harness.io.sockets.sockets.get(authenticated.transportId);
    assert.ok(serverSocket);
    assert.equal(verifiedToken, "valid-access-token");
    assert.equal(serverSocket.data.accountId, accountId);

    const created = await emitWithAck(authenticated, "create-room", {
        playerName: "Account holder",
    });
    harness.trackRoom(created.roomCode);
    assert.equal(roomManager.getRoom(created.roomCode).hostId, authenticated.id);
    assert.notEqual(serverSocket.data.accountId, authenticated.id);
});

test("authenticated profile socket operations use only the verified Firebase UID", async (context) => {
    const verifiedUid = "firebase-custom:uid-123";
    const profileCalls = [];
    const profileRepository = {
        async getOrCreateProfile(accountId) {
            profileCalls.push(["get", accountId]);
            return {
                id: accountId,
                display_name: "Player",
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
            };
        },
        async updateDisplayName(accountId, displayName) {
            profileCalls.push(["update", accountId, displayName]);
            return {
                id: accountId,
                display_name: displayName,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-02T00:00:00.000Z",
            };
        },
    };
    const harness = await createHarness(context, {
        verifyAccessToken: async (token) => {
            assert.equal(token, "valid-profile-token");
            return verifiedUid;
        },
        profileRepository,
    });
    const authenticated = await harness.connect({
        auth: { accessToken: "valid-profile-token" },
    });
    const profile = await new Promise((resolve, reject) => {
        authenticated.emit("get-profile", (response) => {
            if (response.error) reject(new Error(response.error.message));
            else resolve(response.profile);
        });
    });
    assert.equal(profile.id, verifiedUid);

    const updated = await new Promise((resolve, reject) => {
        authenticated.emit(
            "update-profile-display-name",
            { displayName: "New Name", accountId: "client-supplied-victim" },
            (response) => {
                if (response.error) reject(new Error(response.error.message));
                else resolve(response.profile);
            },
        );
    });
    assert.equal(updated.id, verifiedUid);
    assert.deepEqual(profileCalls, [
        ["get", verifiedUid],
        ["update", verifiedUid, "New Name"],
    ]);
});

for (const [label, accessToken] of [
    ["invalid", "invalid-access-token"],
    ["expired", "expired-access-token"],
]) {
    test(`${label} access tokens are rejected instead of becoming guest connections`, async (context) => {
        let verifiedToken;
        const harness = await createHarness(context, {
            verifyAccessToken: async (token) => {
                verifiedToken = token;
                throw Object.assign(new Error("Firebase rejected the token."), {
                    code: "auth/invalid-id-token",
                });
            },
        });
        const client = createClient(
            `http://127.0.0.1:${harness.io.httpServer.address().port}`,
            {
                auth: { accessToken },
                reconnection: false,
                timeout: 3000,
            }
        );
        const connectError = new Promise((resolve) => {
            client.once("connect_error", resolve);
        });
        context.after(() => client.close());
        const error = await connectError;
        assert.equal(verifiedToken, accessToken);
        assert.equal(error.message, "Invalid or expired access token.");
        assert.equal(client.connected, false);
    });
}

test("a supplied token is rejected when server-side Firebase verification is not configured", async (context) => {
    const harness = await createHarness(context);
    const client = createClient(
        `http://127.0.0.1:${harness.io.httpServer.address().port}`,
        {
            auth: { accessToken: "unverifiable-access-token" },
            reconnection: false,
            timeout: 3000,
        }
    );
    const connectError = new Promise((resolve) => {
        client.once("connect_error", resolve);
    });
    context.after(() => client.close());

    const error = await connectError;
    assert.equal(error.message, "Invalid or expired access token.");
    assert.equal(client.connected, false);
});

test("Firebase verification service failures are not misreported as invalid tokens", async (context) => {
    const harness = await createHarness(context, {
        verifyAccessToken: async () => {
            throw Object.assign(new Error("Firebase network unavailable."), {
                code: "app/network-error",
            });
        },
    });
    const client = createClient(
        `http://127.0.0.1:${harness.io.httpServer.address().port}`,
        {
            auth: { accessToken: "valid-format-token" },
            reconnection: false,
            timeout: 3000,
        }
    );
    const connectError = new Promise((resolve) => {
        client.once("connect_error", resolve);
    });
    context.after(() => client.close());

    const error = await connectError;
    assert.equal(error.message, "Authentication verification is temporarily unavailable.");
    assert.equal(client.connected, false);
});

function emitWithAck(client, event, payload, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error(`${event} acknowledgement timed out`)),
            timeoutMs
        );
        const acknowledge = (response) => {
            clearTimeout(timeout);
            resolve(response);
        };
        if (payload === undefined) {
            client.emit(event, acknowledge);
        } else {
            client.emit(event, payload, acknowledge);
        }
    });
}

function withRoundId(gameState, payload) {
    return {
        ...payload,
        sessionId: gameState.sessionId,
        roundId: gameState.state.roundId
    };
}

function waitForLobby(client, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.off("lobby-state", onLobby);
            reject(new Error("lobby-state event timed out"));
        }, 3000);
        function onLobby(lobby) {
            if (!predicate(lobby)) {
                return;
            }
            clearTimeout(timeout);
            client.off("lobby-state", onLobby);
            resolve(lobby);
        }
        client.on("lobby-state", onLobby);
    });
}

function waitForPublicRooms(client, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.off("public-rooms-updated", onRooms);
            reject(new Error("public-rooms-updated event timed out"));
        }, 3000);
        function onRooms(payload) {
            if (!predicate(payload.rooms)) return;
            clearTimeout(timeout);
            client.off("public-rooms-updated", onRooms);
            resolve(payload.rooms);
        }
        client.on("public-rooms-updated", onRooms);
    });
}

function waitForGameState(client, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.off("game-state", onGameState);
            reject(new Error("game-state event timed out"));
        }, 3000);
        function onGameState(gameState) {
            if (!predicate(gameState)) {
                return;
            }
            clearTimeout(timeout);
            client.off("game-state", onGameState);
            resolve(gameState);
        }
        client.on("game-state", onGameState);
    });
}

function waitForGameStart(client) {
    return new Promise((resolve, reject) => {
        const events = [];
        let startingPayload;
        let gameState;
        const timeout = setTimeout(() => {
            client.off("game-starting", onStarting);
            client.off("game-state", onGameState);
            reject(new Error("game start flow timed out"));
        }, 3000);

        function finishIfComplete() {
            if (!startingPayload || !gameState) {
                return;
            }
            clearTimeout(timeout);
            client.off("game-starting", onStarting);
            client.off("game-state", onGameState);
            resolve({ events, startingPayload, gameState });
        }

        function onStarting(payload) {
            events.push("game-starting");
            startingPayload = payload;
            finishIfComplete();
        }

        function onGameState(payload) {
            events.push("game-state");
            gameState = payload;
            finishIfComplete();
        }

        client.on("game-starting", onStarting);
        client.on("game-state", onGameState);
    });
}

async function joinPlayers(harness, roomCode, count) {
    const players = [];
    for (let index = 0; index < count; index += 1) {
        const player = await harness.connect();
        const response = await emitWithAck(player, "join-room", {
            roomCode,
            playerName: `Guest ${index + 1}`,
        });
        assert.equal(response.error, undefined);
        players.push(player);
    }
    return players;
}

async function disconnectAndRecover(harness, client) {
    const playerId = client.playerId;
    client.disconnect();
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (harness.io.disconnectGraceManager.entries.has(playerId)) break;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(
        harness.io.disconnectGraceManager.entries.has(playerId),
        "the server should begin the grace period after disconnect",
    );
    const recovered = await harness.connect({ storage: client.recoveryStorage });
    assert.equal(recovered.playerId, playerId);
    return recovered;
}

function finishManagedFactOrCapGame(roomCode, players) {
    let result;
    for (let round = 1; round <= 5; round += 1) {
        const current = gameManager.getPublicGameState(roomCode, players[0]);
        const question = questions.find(({ text }) => text === current.state.prompt.text);
        assert.ok(question);
        gameManager.performGameAction(
            roomCode,
            "fact-or-cap",
            null,
            "open-submissions",
            { roundId: current.state.roundId },
        );
        players.forEach((playerId, index) => {
            gameManager.performGameAction(
                roomCode,
                "fact-or-cap",
                playerId,
                "submit-completion",
                `Round ${round} answer ${index + 1}`,
            );
        });
        gameManager.performGameAction(roomCode, "fact-or-cap", null, "begin-voting");
        players.forEach((playerId) => {
            const voting = gameManager.getPublicGameState(roomCode, playerId);
            const correct = voting.state.options.find(
                ({ completion }) => completion === question.correctCompletion,
            );
            assert.ok(correct);
            gameManager.performGameAction(
                roomCode,
                "fact-or-cap",
                playerId,
                "vote",
                correct.id,
            );
        });
        result = gameManager.performGameAction(
            roomCode,
            "fact-or-cap",
            null,
            "publish-results",
        ).gameState;
        if (round < 5) {
            players.forEach((playerId) => {
                gameManager.performGameAction(roomCode, "fact-or-cap", playerId, "continue");
            });
        }
    }
    return result;
}

async function startFakeAnswer(
    harness,
    {
        playerCount = 4,
        waitForSubmission = true,
        gameId = "fact-or-cap",
        roundCount = 5,
        visibility = "private"
    } = {}
) {
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
        visibility,
    });
    harness.trackRoom(created.roomCode);
    const players = await joinPlayers(harness, created.roomCode, playerCount - 1);
    if (gameId !== "fact-or-cap") {
        const selection = await emitWithAck(host, "select-game", { gameId });
        assert.equal(selection.selectedGameId, gameId);
        assert.equal(selection.lobby.selectedGameId, gameId);
    }
    if (roundCount !== 5) {
        const revision = roomManager.createLobbyState(
            roomManager.getRoom(created.roomCode)
        ).revision;
        const selection = await emitWithAck(host, "select-round-count", {
            roundCount,
            revision
        });
        assert.equal(selection.selectedRoundCount, roundCount);
    }
    for (const player of players) {
        await emitWithAck(player, "set-ready", { isReady: true });
    }

    const initialState = waitForGameState(host, (game) => game.state.phase === "question");
    const startResponse = await emitWithAck(host, "start-game");
    assert.equal(startResponse.starting, true);
    assert.equal(startResponse.game.state.phase, "question");
    assert.ok(startResponse.game.state.prompt.text);
    const questionState = await initialState;
    assert.deepEqual(startResponse.game, questionState);
    if (!waitForSubmission) {
        return {
            host,
            players,
            roomCode: created.roomCode,
            questionState
        };
    }
    const states = [host, ...players].map((client) =>
        waitForGameState(client, (game) => game.state.phase === "answer-submission")
    );
    const receivedStates = await Promise.all(states);
    for (const gameState of receivedStates.slice(1)) {
        assert.deepEqual(gameState, receivedStates[0]);
    }

    return {
        host,
        players,
        roomCode: created.roomCode,
        questionState,
        gameState: receivedStates[0]
    };
}

function waitForEvent(client, event) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.off(event, onEvent);
            reject(new Error(`${event} event timed out`));
        }, 3000);
        function onEvent(payload) {
            clearTimeout(timeout);
            resolve(payload);
        }
        client.once(event, onEvent);
    });
}

test("room chat sends only server-authored member messages and paginates history", async (context) => {
    const harness = await createHarness(context, { authEnabled: false });
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host", visibility: "public" });
    harness.trackRoom(created.roomCode);
    const browser = await harness.connect();
    await emitWithAck(browser, "subscribe-public-rooms");
    let browserChatEvents = 0;
    browser.on("chat:message", () => { browserChatEvents += 1; });
    const guest = await harness.connect();
    const joinedMessage = waitForEvent(host, "chat:message");
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    assert.equal((await joinedMessage).message.text, "Guest joined the room.");

    const hostMessage = waitForEvent(guest, "chat:message");
    const selfMessage = waitForEvent(host, "chat:message");
    const sent = await emitWithAck(host, "chat:send", { text: "Hello room 🙂" });
    assert.equal(sent.sent, true);
    const [received, echoed] = await Promise.all([hostMessage, selfMessage]);
    assert.deepEqual(received, echoed);
    assert.deepEqual(received.message, {
        id: sent.messageId,
        type: "player",
        senderName: "Host",
        text: "Hello room 🙂",
        createdAt: received.message.createdAt,
    });
    assert.equal("senderId" in received.message, false);
    assert.equal("playerId" in received.message, false);
    assert.equal((await emitWithAck(host, "chat:send", { text: "forged", senderId: guest.playerId })).error.code, "INVALID_REQUEST");

    const outsider = await harness.connect();
    assert.equal((await emitWithAck(outsider, "chat:send", { text: "intrude" })).error.code, "NOT_IN_ROOM");
    assert.equal((await emitWithAck(outsider, "chat:history:request", { before: null, limit: 50 })).error.code, "NOT_IN_ROOM");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(browserChatEvents, 0);

    const historyEvent = waitForEvent(host, "chat:history:response");
    assert.deepEqual(await emitWithAck(host, "chat:history:request", { before: null, limit: 50, requestId: "history-1" }), { ok: true });
    const history = await historyEvent;
    assert.equal(history.requestId, "history-1");
    assert.equal(history.messages.some(({ text }) => text === "Guest joined the room."), true);
    assert.equal(history.messages.some(({ id }) => id === sent.messageId), true);

    for (let index = 1; index < 5; index += 1) {
        assert.equal((await emitWithAck(host, "chat:send", { text: `allowed ${index}` })).sent, true);
    }
    assert.equal((await emitWithAck(host, "chat:send", { text: "rate limited" })).error.code, "CHAT_RATE_LIMITED");
});

test("room chat is blocked during play, enabled at finished results, and excludes returned viewers", async (context) => {
    const harness = await createHarness(context, { authEnabled: false });
    const game = await startFakeAnswer(harness, { playerCount: 2, waitForSubmission: false });
    assert.equal((await emitWithAck(game.host, "chat:send", { text: "during game" })).error.code, "CHAT_NOT_AVAILABLE");
    assert.equal((await emitWithAck(game.players[0], "chat:history:request", { before: null, limit: 50 })).error.code, "CHAT_NOT_AVAILABLE");

    const finalState = finishManagedFactOrCapGame(game.roomCode, [game.host.playerId, game.players[0].playerId]);
    assert.equal(finalState.status, "finished");
    const resultEvent = waitForEvent(game.players[0], "chat:message");
    const sent = await emitWithAck(game.host, "chat:send", { text: "Results chat" });
    assert.equal(sent.sent, true);
    assert.equal((await resultEvent).message.text, "Results chat");

    assert.deepEqual(await emitWithAck(game.host, "return-to-lobby", { sessionId: finalState.sessionId }), { returned: true });
    assert.equal((await emitWithAck(game.players[0], "chat:send", { text: "still viewing" })).sent, true);
    assert.deepEqual(await emitWithAck(game.players[0], "return-from-results", { sessionId: finalState.sessionId }), { returned: true, status: "lobby" });
    assert.equal((await emitWithAck(game.players[0], "chat:send", { text: "back in lobby" })).sent, true);
});

test("room chat records join, leave, and disconnect system messages once and restores them after reconnect", async (context) => {
    const harness = await createHarness(context, { authEnabled: false });
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    const guest = await harness.connect();
    const joinEvent = waitForEvent(host, "chat:message");
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    assert.equal((await joinEvent).message.type, "system");

    const leaveEvent = waitForEvent(host, "chat:message");
    assert.deepEqual(await emitWithAck(guest, "leave-room"), { left: true });
    assert.equal((await leaveEvent).message.text, "Guest left the room.");
    assert.equal((await emitWithAck(guest, "chat:history:request", { before: null, limit: 50 })).error.code, "NOT_IN_ROOM");

    const secondJoinEvent = waitForEvent(host, "chat:message");
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    await secondJoinEvent;
    const disconnectedEvent = waitForEvent(host, "chat:message");
    guest.disconnect();
    assert.equal((await disconnectedEvent).message.text, "Guest disconnected.");
    const recovered = await disconnectAndRecover(harness, guest);
    assert.equal((await emitWithAck(recovered, "restore-session")).status, "restored");
    const restoredHistoryEvent = waitForEvent(recovered, "chat:history:response");
    assert.deepEqual(await emitWithAck(recovered, "chat:history:request", { before: null, limit: 50, requestId: "restore" }), { ok: true });
    const history = await restoredHistoryEvent;
    assert.equal(history.messages.filter(({ text }) => text === "Guest disconnected.").length, 1);
    assert.equal(history.messages.some(({ text }) => text.toLowerCase().includes("reconnected")), false);
});

test("kicked members lose chat access and room destruction clears its lifetime history", async (context) => {
    const harness = await createHarness(context, { authEnabled: false });
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    const guest = await harness.connect();
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    const room = roomManager.getRoom(created.roomCode);
    const roomId = room.publicRoomId;
    assert.equal((await emitWithAck(host, "kick-player", { targetPlayerId: guest.playerId })).kicked, true);
    assert.equal((await emitWithAck(guest, "chat:send", { text: "after kick" })).error.code, "NOT_IN_ROOM");
    const historyEvent = waitForEvent(host, "chat:history:response");
    await emitWithAck(host, "chat:history:request", { before: null, limit: 50, requestId: "kicked" });
    const history = await historyEvent;
    assert.equal(history.messages.filter(({ text }) => text === "Guest was kicked from the room.").length, 1);

    await emitWithAck(host, "leave-room");
    assert.equal(harness.io.roomChatManager.getMessageCount(roomId), 0);
});

test("room chat rate limits survive a socket reconnect for the same player identity", async (context) => {
    const harness = await createHarness(context, { authEnabled: false });
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    const guest = await harness.connect();
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    for (let index = 0; index < 5; index += 1) {
        assert.equal((await emitWithAck(host, "chat:send", { text: `message ${index}` })).sent, true);
    }
    const playerId = host.playerId;
    const recovered = await disconnectAndRecover(harness, host);
    assert.equal(recovered.playerId, playerId);
    assert.equal((await emitWithAck(recovered, "restore-session")).status, "restored");
    assert.equal((await emitWithAck(recovered, "chat:send", { text: "sixth message" })).error.code, "CHAT_RATE_LIMITED");
});

async function completeSocketRound(host, players, gameState) {
    const clients = [host, ...players];
    const questionBank = gameState.gameId === "fact-or-cap-anime"
        ? animeQuestions
        : questions;
    const question = questionBank.find(
        ({ text }) => text === gameState.state.prompt.text
    );
    assert.ok(question);
    const votingEvents = clients.map((client) =>
        waitForGameState(
            client,
            (state) =>
                state.state.phase === "voting" &&
                state.state.roundId === gameState.state.roundId
        )
    );
    for (let index = 0; index < clients.length; index += 1) {
        const response = await emitWithAck(
            clients[index],
            "fake-answer:submit",
            withRoundId(gameState, {
                completion: `Round ${gameState.state.currentRound} answer ${index + 1}`,
            })
        );
        assert.equal(response.error, undefined);
    }
    const votingStates = await Promise.all(votingEvents);
    const resultsEvents = clients.map((client) =>
        waitForGameState(
            client,
            (state) =>
                state.state.phase === "results" &&
                state.state.roundId === gameState.state.roundId
        )
    );
    for (let index = 0; index < clients.length; index += 1) {
        const option = votingStates[index].state.options.find(
            ({ completion }) => completion === question.correctCompletion
        );
        assert.ok(option);
        const response = await emitWithAck(
            clients[index],
            "fake-answer:vote",
            withRoundId(votingStates[index], { optionId: option.id })
        );
        assert.equal(response.error, undefined);
    }
    return Promise.all(resultsEvents);
}

function interceptScheduledSubmissionCallback() {
    const callbacks = [];
    const originalScheduler = factOrCapSocketHandlers.scheduleSubmissionPhase;
    factOrCapSocketHandlers.scheduleSubmissionPhase = (...schedulerArgs) => {
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (callback, delay, ...timerArgs) => {
            assert.equal(delay, 1500);
            callbacks.push({
                schedulerArgs,
                run: () => callback(...timerArgs)
            });
            return { unref() {} };
        };
        try {
            originalScheduler(...schedulerArgs);
        } finally {
            global.setTimeout = originalSetTimeout;
        }
    };
    return {
        callbacks,
        restore() {
            factOrCapSocketHandlers.scheduleSubmissionPhase = originalScheduler;
        }
    };
}

test("Socket.IO departure schedules one guarded next-round submission transition for both Fact-or-Cap games", async (context) => {
    const harness = await createHarness(context);
    for (const gameId of ["fact-or-cap", "fact-or-cap-anime"]) {
        for (const departureType of ["leave", "disconnect"]) {
            const game = await startFakeAnswer(harness, { playerCount: 3, gameId });
            const [host, guest, leaver] = [game.host, ...game.players];
            const previousRoundId = game.gameState.state.roundId;
            await completeSocketRound(host, [guest, leaver], game.gameState);

            for (const client of [host, guest]) {
                const results = gameManager.getPublicGameState(game.roomCode, client.id);
                assert.equal(results.state.phase, "results");
                const continued = await emitWithAck(client, "fake-answer:continue", {
                    sessionId: results.sessionId,
                    roundId: results.state.roundId
                });
                assert.equal(continued.error, undefined);
            }

            const nextRoundStates = [host, guest].map((client) => waitForGameState(client, (state) =>
                state.sessionId === game.gameState.sessionId &&
                state.state.roundId !== previousRoundId &&
                state.state.phase === "question"
            ));
            const scheduled = interceptScheduledSubmissionCallback();
            try {
                if (departureType === "leave") {
                    assert.deepEqual(await emitWithAck(leaver, "leave-room"), { left: true });
                } else {
                    const serverSocket = harness.io.sockets.sockets.get(leaver.transportId);
                    const disconnected = new Promise((resolve) => serverSocket.once("disconnect", resolve));
                    leaver.disconnect();
                    await disconnected;
                    await harness.advanceGrace();
                }
            } finally {
                scheduled.restore();
            }

            const [hostQuestion, guestQuestion] = await Promise.all(nextRoundStates);
            assert.equal(hostQuestion.state.roundId, guestQuestion.state.roundId);
            if (departureType === "disconnect") {
                assert.deepEqual(hostQuestion.players.map(({ id }) => id), [host.id, guest.id, leaver.id]);
                assert.equal(
                    hostQuestion.players.find(({ id }) => id === leaver.id).connected,
                    false
                );
            } else {
                assert.deepEqual(hostQuestion.players.map(({ id }) => id), [host.id, guest.id]);
            }
            assert.equal(hostQuestion.state.phase, "question");
            assert.equal(scheduled.callbacks.length, 1);
            const [timer] = scheduled.callbacks;
            assert.equal(timer.schedulerArgs[1], game.roomCode);
            assert.equal(timer.schedulerArgs[2], game.gameState.sessionId);
            assert.equal(timer.schedulerArgs[3], hostQuestion.state.roundId);
            assert.equal(timer.schedulerArgs[4], gameId);

            const phaseEvents = [[], []];
            const listeners = [host, guest].map((client, index) => {
                const listener = (state) => {
                    if (state.sessionId === hostQuestion.sessionId && state.state.roundId === hostQuestion.state.roundId) {
                        phaseEvents[index].push(state.state.phase);
                    }
                };
                client.on("game-state", listener);
                return () => client.off("game-state", listener);
            });
            const opened = [host, guest].map((client) => waitForGameState(client, (state) =>
                state.sessionId === hostQuestion.sessionId &&
                state.state.roundId === hostQuestion.state.roundId &&
                state.state.phase === "answer-submission"
            ));
            timer.run();
            timer.run();
            const submissionStates = await Promise.all(opened);
            await new Promise((resolve) => setImmediate(resolve));
            listeners.forEach((stop) => stop());
            for (const phases of phaseEvents) {
                assert.deepEqual(phases, ["answer-submission"], `${gameId} ${departureType} callback should broadcast once`);
            }
            assert.ok(submissionStates.every(({ players, state }) =>
                state.phase === "answer-submission" &&
                players.length === 2 &&
                players.every(({ id }) => id !== leaver.id)
            ));
            if (departureType === "leave") {
                assert.throws(() => gameManager.getPublicGameState(game.roomCode, leaver.id), {
                    code: "NOT_A_GAME_PLAYER"
                });
            }
            if (departureType === "leave") {
                const state = gameManager.getPublicGameState(game.roomCode, host.id);
                const rejected = await emitWithAck(leaver, "fake-answer:submit", withRoundId(state, {
                    completion: "departed player cannot submit in the next round"
                }));
                assert.equal(rejected.error.code, "NOT_IN_ROOM");
            }
        }
    }
});

test("starts the server and keeps the legacy create-room acknowledgement", async (context) => {
    assert.equal(defaultPort, 3000);
    const harness = await createHarness(context);
    const client = await harness.connect();
    const lobbyEvent = waitForLobby(client);

    const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("create-room acknowledgement timed out")),
            3000
        );
        client.emit("create-room", (acknowledgement) => {
            clearTimeout(timeout);
            resolve(acknowledgement);
        });
    });

    assert.match(response.roomCode, /^[A-Z]{4}$/);
    assert.deepEqual(Object.keys(response), ["roomCode"]);
    harness.trackRoom(response.roomCode);
    const lobby = await lobbyEvent;
    assert.equal(lobby.roomCode, response.roomCode);
    assert.equal(lobby.playerCount, 1);
    assert.equal(lobby.players[0].id, client.id);
    assert.equal(lobby.players[0].name, "Player");
    assert.equal(lobby.players[0].isHost, true);
    assert.equal(lobby.players[0].isReady, false);
    assert.equal(lobby.status, "lobby");
    assert.equal(lobby.readinessStatus, "insufficient-players");
    assert.equal(lobby.selectedRoundCount, 5);

    const serverSocket = harness.io.sockets.sockets.get(client.transportId);
    assert.ok(serverSocket.rooms.has(response.roomCode));
});

test("lists registered games and creates a room with the requested game before its first lobby update", async (context) => {
    const harness = await createHarness(context);
    const client = await harness.connect();
    const list = await emitWithAck(client, "list-games", undefined);
    assert.deepEqual(list.games.map(({ id }) => id), [
        "fact-or-cap",
        "fact-or-cap-anime",
        "bruh-wtf"
    ]);
    assert.ok(list.games.every(({ maxPlayers }) => maxPlayers === roomManager.MAX_ROOM_CAPACITY));

    const firstLobby = waitForLobby(client);
    const created = await emitWithAck(client, "create-room", {
        playerName: "Anime Host",
        gameId: "fact-or-cap-anime"
    });
    harness.trackRoom(created.roomCode);
    const lobby = await firstLobby;
    assert.equal(lobby.selectedGameId, "fact-or-cap-anime");
    assert.equal(roomManager.getRoom(created.roomCode).selectedGameId, "fact-or-cap-anime");

    const invalidClient = await harness.connect();
    const rejected = await emitWithAck(invalidClient, "create-room", {
        playerName: "Another Host",
        gameId: "not-a-registered-game"
    });
    assert.equal(rejected.error.code, "GAME_NOT_FOUND");
    assert.equal(roomManager.getPlayerRoom(invalidClient.id), null);
    assert.equal(roomManager.getRoom(lobby.roomCode).selectedGameId, "fact-or-cap-anime");
});

test("public room browser lists only safe metadata, revalidates joins, and follows room eligibility", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const initialList = await emitWithAck(host, "subscribe-public-rooms", undefined);
    assert.deepEqual(initialList.rooms, []);

    const createdRoomList = waitForPublicRooms(host, (rooms) => rooms.length === 1);
    const created = await emitWithAck(host, "create-room", {
        playerName: "Hidden Host Name",
        gameId: "fact-or-cap",
        visibility: "public"
    });
    harness.trackRoom(created.roomCode);
    const [listedRoom] = await createdRoomList;
    assert.equal(listedRoom.playerCount, 1);
    assert.equal(listedRoom.maxPlayers, roomManager.MAX_ROOM_CAPACITY);
    assert.equal(listedRoom.gameName, "Fact or Cap");
    assert.equal(listedRoom.hostName, "Hidden Host Name");
    assert.equal(JSON.stringify(listedRoom).includes(created.roomCode), false);
    assert.equal(Object.hasOwn(listedRoom, "players"), false);
    assert.deepEqual((await emitWithAck(host, "refresh-public-rooms", undefined)).rooms, [listedRoom]);

    const joinedUpdate = waitForPublicRooms(host, (rooms) => rooms[0]?.playerCount === 2);
    const joined = await emitWithAck(guest, "join-public-room", {
        publicRoomId: listedRoom.roomId,
        playerName: "Public Guest"
    });
    assert.equal(joined.error, undefined);
    assert.equal(joined.lobby.roomCode, created.roomCode);
    assert.equal((await joinedUpdate)[0].playerCount, 2);

    const privateUpdate = waitForPublicRooms(host, (rooms) => rooms.length === 0);
    const madePrivate = await emitWithAck(host, "set-room-visibility", { visibility: "private" });
    assert.equal(madePrivate.visibility, "private");
    assert.equal(madePrivate.lobby.visibility, "private");
    assert.deepEqual(await privateUpdate, []);

    const lateGuest = await harness.connect();
    const deniedPublicJoin = await emitWithAck(lateGuest, "join-public-room", {
        publicRoomId: listedRoom.roomId,
        playerName: "Late Guest"
    });
    assert.equal(deniedPublicJoin.error.code, "ROOM_NOT_PUBLIC");
    assert.equal(roomManager.getRoom(created.roomCode).players.length, 2);

    const invalidVisibility = await emitWithAck(host, "set-room-visibility", { visibility: "unlisted" });
    assert.equal(invalidVisibility.error.code, "INVALID_VISIBILITY");
    const nonHostVisibility = await emitWithAck(guest, "set-room-visibility", { visibility: "public" });
    assert.equal(nonHostVisibility.error.code, "NOT_HOST");

    const publicAgain = waitForPublicRooms(host, (rooms) => rooms.length === 1);
    const changedBack = await emitWithAck(host, "set-room-visibility", { visibility: "public" });
    assert.equal(changedBack.visibility, "public");
    const [reopened] = await publicAgain;

    const finalSlot = roomManager.MAX_ROOM_CAPACITY - 3;
    const extraGuests = [];
    for (let index = 0; index < finalSlot; index += 1) {
        const player = await harness.connect();
        extraGuests.push(player);
        const response = await emitWithAck(player, "join-room", {
            roomCode: created.roomCode,
            playerName: `Code Guest ${index + 1}`
        });
        assert.equal(response.error, undefined);
    }
    const fullRoomUpdate = waitForPublicRooms(host, (rooms) => rooms.length === 0);
    const publicContenders = [await harness.connect(), await harness.connect()];
    const concurrentPublicJoins = await Promise.all(publicContenders.map((player, index) =>
        emitWithAck(player, "join-public-room", {
            publicRoomId: reopened.roomId,
            playerName: `Concurrent ${index + 1}`
        })
    ));
    assert.equal(concurrentPublicJoins.filter(({ error }) => !error).length, 1);
    assert.equal(concurrentPublicJoins.filter(({ error }) => error?.code === "ROOM_FULL").length, 1);
    assert.deepEqual(await fullRoomUpdate, []);
    assert.equal(roomManager.getRoom(created.roomCode).players.length, roomManager.MAX_ROOM_CAPACITY);
    assert.deepEqual(roomManager.listPublicRooms().filter(({ roomId }) => roomId === reopened.roomId), []);
    const fullJoiner = await harness.connect();
    const fullPublicJoin = await emitWithAck(fullJoiner, "join-public-room", {
        publicRoomId: reopened.roomId,
        playerName: "Ninth Player"
    });
    assert.equal(fullPublicJoin.error.code, "ROOM_FULL");
    const fullCodeJoiner = await harness.connect();
    const fullCodeJoin = await emitWithAck(fullCodeJoiner, "join-room", {
        roomCode: created.roomCode,
        playerName: "Code Ninth"
    });
    assert.equal(fullCodeJoin.error.code, "ROOM_FULL");
    assert.equal(roomManager.getRoom(created.roomCode).players.length, roomManager.MAX_ROOM_CAPACITY);

    const departureUpdate = waitForPublicRooms(host, (rooms) => rooms[0]?.playerCount === 7);
    assert.deepEqual(await emitWithAck(extraGuests[0], "leave-room", undefined), { left: true });
    assert.equal((await departureUpdate)[0].roomId, reopened.roomId);

    const room = roomManager.getRoom(created.roomCode);
    for (const player of room.players.filter(({ id }) => id !== host.id)) {
        const client = [guest, ...extraGuests, ...publicContenders].find(({ id }) => id === player.id);
        assert.ok(client);
        const ready = await emitWithAck(client, "set-ready", { isReady: true });
        assert.equal(ready.error, undefined);
    }
    const noLongerLobby = waitForPublicRooms(host, (rooms) => rooms.length === 0);
    const started = await emitWithAck(host, "start-game", undefined);
    assert.equal(started.error, undefined);
    assert.deepEqual(await noLongerLobby, []);
    assert.equal((await emitWithAck(host, "set-room-visibility", { visibility: "private" })).error.code, "ROOM_NOT_IN_LOBBY");
    const staleJoiner = await harness.connect();
    const startedJoin = await emitWithAck(staleJoiner, "join-public-room", {
        publicRoomId: reopened.roomId,
        playerName: "After Start"
    });
    assert.equal(startedJoin.error.code, "ROOM_NOT_IN_LOBBY");
});

test("public room subscription, refresh, and live updates use canonical occupancy ordering", async (context) => {
    const harness = await createHarness(context);
    const browser = await harness.connect();
    const firstHost = await harness.connect();
    const secondHost = await harness.connect();
    assert.deepEqual((await emitWithAck(browser, "subscribe-public-rooms", undefined)).rooms, []);

    const firstAppears = waitForPublicRooms(browser, (rooms) => rooms.length === 1);
    const firstRoom = await emitWithAck(firstHost, "create-room", {
        playerName: "First Host",
        visibility: "public"
    });
    harness.trackRoom(firstRoom.roomCode);
    await firstAppears;

    const secondAppears = waitForPublicRooms(browser, (rooms) => rooms.length === 2);
    const secondRoom = await emitWithAck(secondHost, "create-room", {
        playerName: "Second Host",
        visibility: "public"
    });
    harness.trackRoom(secondRoom.roomCode);
    const initialLiveList = await secondAppears;
    const subscribedList = await emitWithAck(browser, "subscribe-public-rooms", undefined);
    const refreshedList = await emitWithAck(browser, "refresh-public-rooms", undefined);
    assert.deepEqual(subscribedList.rooms, initialLiveList);
    assert.deepEqual(refreshedList.rooms, initialLiveList);
    assert.deepEqual(initialLiveList, roomManager.listPublicRooms());

    const targetRoom = [firstRoom, secondRoom].find(({ roomCode }) =>
        roomManager.getRoom(roomCode).publicRoomId !== initialLiveList[0].roomId
    );
    assert.ok(targetRoom);
    const targetRoomState = roomManager.getRoom(targetRoom.roomCode);
    let lastLiveList;
    for (let index = 1; index <= 3; index += 1) {
        const count = index + 1;
        const countUpdate = waitForPublicRooms(browser, (rooms) =>
            rooms.find(({ roomId }) => roomId === targetRoomState.publicRoomId)?.playerCount === count
        );
        const guest = await harness.connect();
        const joined = await emitWithAck(guest, "join-room", {
            roomCode: targetRoom.roomCode,
            playerName: `Ordering Guest ${index}`
        });
        assert.equal(joined.error, undefined);
        harness.trackRoom(targetRoom.roomCode);
        lastLiveList = await countUpdate;
    }

    assert.equal(lastLiveList[0].roomId, targetRoomState.publicRoomId);
    assert.deepEqual(lastLiveList, roomManager.listPublicRooms());
    assert.deepEqual((await emitWithAck(browser, "refresh-public-rooms", undefined)).rooms, lastLiveList);
});

test("host can kick a lobby player through departure reconciliation; unauthorized and stale requests are rejected", async (context) => {
    const harness = await createHarness(context);
    const browser = await harness.connect();
    await emitWithAck(browser, "subscribe-public-rooms", undefined);
    const host = await harness.connect();
    const stale = await harness.connect();
    const target = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
        visibility: "public"
    });
    harness.trackRoom(created.roomCode);
    await emitWithAck(stale, "join-room", { roomCode: created.roomCode, playerName: "Stale" });
    await emitWithAck(target, "join-room", { roomCode: created.roomCode, playerName: "Target" });

    assert.equal((await emitWithAck(target, "kick-player", { targetPlayerId: host.id })).error.code, "NOT_HOST");
    assert.equal((await emitWithAck(host, "kick-player", { targetPlayerId: host.id })).error.code, "CANNOT_KICK_SELF");
    assert.equal((await emitWithAck(host, "kick-player", { targetPlayerId: "missing-player" })).error.code, "TARGET_NOT_FOUND");
    assert.equal((await emitWithAck(host, "kick-player", {})).error.code, "INVALID_REQUEST");

    assert.deepEqual(await emitWithAck(stale, "leave-room", undefined), { left: true });
    assert.equal((await emitWithAck(host, "kick-player", { targetPlayerId: stale.id })).error.code, "TARGET_NOT_FOUND");

    const removedEvent = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("removed-from-room event timed out")), 3000);
        target.once("removed-from-room", (payload) => {
            clearTimeout(timeout);
            resolve(payload);
        });
    });
    const lobbyUpdate = waitForLobby(host, (lobby) => lobby.playerCount === 1 && lobby.players.length === 1);
    const publicUpdate = waitForPublicRooms(browser, (rooms) => rooms.length === 1 && rooms[0].playerCount === 1);
    const kicked = await emitWithAck(host, "kick-player", { targetPlayerId: target.id });
    assert.deepEqual(kicked, { kicked: true, playerId: target.id });
    assert.deepEqual(await removedEvent, {
        roomCode: created.roomCode,
        reason: "kicked",
        message: "The host removed you from this room."
    });
    const hostLobby = await lobbyUpdate;
    assert.deepEqual(hostLobby.players.map(({ id }) => id), [host.id]);
    assert.equal((await publicUpdate)[0].playerCount, 1);
    assert.equal(roomManager.getPlayerRoom(target.id), null);
    assert.deepEqual(roomManager.getRoom(created.roomCode).players.map(({ id }) => id), [host.id]);

    assert.equal((await emitWithAck(target, "set-ready", { isReady: true })).error.code, "NOT_IN_ROOM");
    assert.equal((await emitWithAck(target, "fake-answer:submit", {
        sessionId: "stale-session",
        roundId: "stale-round",
        completion: "Late answer"
    })).error.code, "NOT_IN_ROOM");
});

test("host transfer validates membership, broadcasts the projected lobby, and transfers subsequent host permissions", async (context) => {
    const harness = await createHarness(context);
    const browser = await harness.connect();
    const host = await harness.connect();
    const guest = await harness.connect();
    const remainingPlayer = await harness.connect();
    const outsiderHost = await harness.connect();
    const outsider = await harness.connect();
    const stale = await harness.connect();
    await emitWithAck(browser, "subscribe-public-rooms", undefined);

    const created = await emitWithAck(host, "create-room", {
        playerName: "Original Host",
        visibility: "public"
    });
    harness.trackRoom(created.roomCode);
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "New Host" });
    await emitWithAck(remainingPlayer, "join-room", { roomCode: created.roomCode, playerName: "Remaining" });
    await emitWithAck(stale, "join-room", { roomCode: created.roomCode, playerName: "Stale" });
    assert.deepEqual(await emitWithAck(stale, "leave-room", undefined), { left: true });
    const outsiderRoom = await emitWithAck(outsiderHost, "create-room", { playerName: "Other Host" });
    harness.trackRoom(outsiderRoom.roomCode);
    await emitWithAck(outsider, "join-room", { roomCode: outsiderRoom.roomCode, playerName: "Outsider" });
    const authoritativeRoom = roomManager.getRoom(created.roomCode);
    roomManager.setRoomVisibility(host.id, "public");
    roomManager.selectRoundCount(host.id, 7, authoritativeRoom.revision);
    roomManager.setPlayerReady(guest.id, true);

    assert.equal((await emitWithAck(guest, "transfer-host", { targetPlayerId: remainingPlayer.id })).error.code, "NOT_HOST");
    assert.equal((await emitWithAck(browser, "transfer-host", { targetPlayerId: guest.id })).error.code, "NOT_IN_ROOM");
    assert.equal((await emitWithAck(host, "transfer-host", { targetPlayerId: host.id })).error.code, "CANNOT_TRANSFER_HOST_TO_SELF");
    assert.equal((await emitWithAck(host, "transfer-host", { targetPlayerId: outsider.id })).error.code, "TARGET_NOT_FOUND");
    assert.equal((await emitWithAck(host, "transfer-host", { targetPlayerId: stale.id })).error.code, "TARGET_NOT_FOUND");
    assert.equal((await emitWithAck(host, "transfer-host", {})).error.code, "INVALID_REQUEST");
    assert.equal(authoritativeRoom.hostId, host.id);

    const targetSocket = harness.io.sockets.sockets.get(remainingPlayer.transportId);
    harness.io.sockets.sockets.delete(remainingPlayer.transportId);
    assert.equal((await emitWithAck(host, "transfer-host", { targetPlayerId: remainingPlayer.id })).error.code, "TARGET_NOT_CONNECTED");
    harness.io.sockets.sockets.set(remainingPlayer.transportId, targetSocket);

    const hostUpdate = waitForLobby(host, (lobby) => lobby.players.some(({ id, isHost }) => id === guest.id && isHost));
    const guestUpdate = waitForLobby(guest, (lobby) => lobby.players.some(({ id, isHost }) => id === guest.id && isHost));
    const remainingUpdate = waitForLobby(remainingPlayer, (lobby) => lobby.players.some(({ id, isHost }) => id === guest.id && isHost));
    const publicHostUpdate = waitForPublicRooms(browser, (rooms) => rooms[0]?.hostName === "New Host");
    const transferred = await emitWithAck(host, "transfer-host", { targetPlayerId: guest.id });
    assert.equal(transferred.transferred, true);
    assert.equal(transferred.playerId, guest.id);
    assert.equal((await hostUpdate).players.find(({ id }) => id === host.id).isHost, false);
    assert.equal((await guestUpdate).players.find(({ id }) => id === guest.id).isHost, true);
    assert.equal((await remainingUpdate).players.find(({ id }) => id === guest.id).isHost, true);
    assert.equal((await publicHostUpdate)[0].hostName, "New Host");
    assert.equal((await emitWithAck(browser, "refresh-public-rooms", undefined)).rooms.length, 1);
    assert.equal(authoritativeRoom.hostId, guest.id);
    assert.deepEqual(authoritativeRoom.players.map(({ id }) => id), [host.id, guest.id, remainingPlayer.id]);
    assert.equal(authoritativeRoom.visibility, "public");
    assert.equal(authoritativeRoom.selectedRoundCount, 7);
    assert.equal(authoritativeRoom.players.find(({ id }) => id === guest.id).isReady, true);
    assert.equal(transferred.lobby.players.find(({ id }) => id === host.id).isHost, false);

    assert.equal((await emitWithAck(host, "set-room-visibility", { visibility: "private" })).error.code, "NOT_HOST");
    assert.equal((await emitWithAck(guest, "set-room-visibility", { visibility: "private" })).visibility, "private");
    assert.equal((await emitWithAck(host, "transfer-host", { targetPlayerId: remainingPlayer.id })).error.code, "NOT_HOST");

    authoritativeRoom.status = "starting";
    assert.equal((await emitWithAck(guest, "transfer-host", { targetPlayerId: remainingPlayer.id })).error.code, "ROOM_NOT_IN_LOBBY");
    authoritativeRoom.status = "lobby";
    roomManager.setPlayerReady(host.id, true);
    roomManager.setPlayerReady(remainingPlayer.id, true);
    const started = await emitWithAck(guest, "start-game", undefined);
    assert.equal(started.error, undefined);
    assert.equal(started.starting, true);
});

test("the former host can leave after explicit transfer without undoing new host identity or room cleanup", async (context) => {
    const harness = await createHarness(context);
    const originalHost = await harness.connect();
    const newHost = await harness.connect();
    const remainingPlayer = await harness.connect();
    const created = await emitWithAck(originalHost, "create-room", { playerName: "Original" });
    harness.trackRoom(created.roomCode);
    await emitWithAck(newHost, "join-room", { roomCode: created.roomCode, playerName: "New" });
    await emitWithAck(remainingPlayer, "join-room", { roomCode: created.roomCode, playerName: "Remaining" });

    assert.equal((await emitWithAck(originalHost, "transfer-host", { targetPlayerId: newHost.id })).transferred, true);
    const formerHostLeft = waitForLobby(newHost, (lobby) => lobby.playerCount === 2 && lobby.players.every(({ id }) => id !== originalHost.id));
    assert.deepEqual(await emitWithAck(originalHost, "leave-room", undefined), { left: true });
    await formerHostLeft;
    assert.equal(roomManager.getRoom(created.roomCode).hostId, newHost.id);
    assert.deepEqual(roomManager.getRoom(created.roomCode).players.map(({ id }) => id), [newHost.id, remainingPlayer.id]);

    const transferredHostLeft = waitForLobby(remainingPlayer, (lobby) => lobby.playerCount === 1 && lobby.players[0]?.isHost);
    const newHostDisconnected = new Promise((resolve) =>
        harness.io.sockets.sockets.get(newHost.transportId).once("disconnect", resolve)
    );
    newHost.disconnect();
    await newHostDisconnected;
    assert.equal(roomManager.getRoom(created.roomCode).hostId, newHost.id);
    await harness.advanceGrace();
    await transferredHostLeft;
    assert.equal(roomManager.getRoom(created.roomCode).hostId, remainingPlayer.id);
    assert.deepEqual(await emitWithAck(remainingPlayer, "leave-room", undefined), { left: true });
    assert.equal(roomManager.getRoom(created.roomCode), null);
});

test("public-room updates follow host transfer and remove a room when its last player leaves", async (context) => {
    const harness = await createHarness(context);
    const browser = await harness.connect();
    const host = await harness.connect();
    const guest = await harness.connect();
    assert.deepEqual((await emitWithAck(browser, "subscribe-public-rooms", undefined)).rooms, []);

    const appeared = waitForPublicRooms(browser, (rooms) => rooms.length === 1);
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
        visibility: "public"
    });
    harness.trackRoom(created.roomCode);
    await appeared;
    const joinedCount = waitForPublicRooms(browser, (rooms) => rooms[0]?.playerCount === 2);
    assert.equal((await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest"
    })).error, undefined);
    await joinedCount;

    const afterTransfer = waitForPublicRooms(browser, (rooms) => rooms[0]?.playerCount === 1 && rooms[0]?.hostName === "Guest");
    const hostDisconnected = new Promise((resolve) =>
        harness.io.sockets.sockets.get(host.transportId).once("disconnect", resolve)
    );
    host.disconnect();
    await hostDisconnected;
    assert.equal(roomManager.getRoom(created.roomCode).hostId, host.id);
    await harness.advanceGrace();
    assert.equal((await afterTransfer)[0].hostName, "Guest");
    assert.equal(roomManager.getRoom(created.roomCode).hostId, guest.id);

    const removed = waitForPublicRooms(browser, (rooms) => rooms.length === 0);
    assert.deepEqual(await emitWithAck(guest, "leave-room", undefined), { left: true });
    await removed;
    assert.equal(roomManager.getRoom(created.roomCode), null);
});

test("serves a minimal HTTP health endpoint without exposing game state", async (context) => {
    const harness = await createHarness(context);
    const address = harness.io.httpServer.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await response.json(), { status: "ok" });
});

test("joins an existing room, normalizes its code, and sends lobby state to both players", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const hostLobbyEvent = waitForLobby(host);
    const createResponse = await emitWithAck(host, "create-room", {
        playerName: "  Host Name ",
    });
    assert.match(createResponse.roomCode, /^[A-Z]{4}$/);
    harness.trackRoom(createResponse.roomCode);
    await hostLobbyEvent;

    const hostUpdate = waitForLobby(host, (lobby) => lobby.playerCount === 2);
    const guestUpdate = waitForLobby(guest, (lobby) => lobby.playerCount === 2);
    const response = await emitWithAck(guest, "join-room", {
        roomCode: ` ${createResponse.roomCode.toLowerCase()} `,
        playerName: "  Guest Name  ",
    });

    assert.equal(response.lobby.roomCode, createResponse.roomCode);
    assert.deepEqual(await hostUpdate, response.lobby);
    assert.deepEqual(await guestUpdate, response.lobby);
    assert.equal(response.lobby.playerCount, 2);
    assert.equal(response.lobby.selectedGameId, "fact-or-cap");
    assert.deepEqual(response.lobby.selectedGame, {
        id: "fact-or-cap",
        displayName: "Fact or Cap",
        description: "A bluffing party game about surprising facts.",
        minPlayers: 2,
        maxPlayers: roomManager.MAX_ROOM_CAPACITY,
        supportsRoundSelection: true
    });
    assert.deepEqual(response.lobby.availableGames.map(({ id }) => id), [
        "fact-or-cap",
        "fact-or-cap-anime",
        "bruh-wtf"
    ]);
    assert.deepEqual(
        response.lobby.players.map(({ id, name, isHost }) => ({ id, name, isHost })),
        [
            { id: host.id, name: "Host Name", isHost: true },
            { id: guest.id, name: "Guest Name", isHost: false },
        ]
    );
    const authoritativeRoom = roomManager.getRoom(createResponse.roomCode);
    assert.deepEqual(
        authoritativeRoom.players.map(({ id, name }) => ({ id, name })),
        [
            { id: host.id, name: "Host Name" },
            { id: guest.id, name: "Guest Name" },
        ]
    );
    assert.equal(authoritativeRoom.hostId, host.id);
    assert.deepEqual(Object.keys(response.lobby).sort(), [
        "availableGames",
        "maxPlayers",
        "playerCount",
        "players",
        "readinessStatus",
        "reminderSessionId",
        "revision",
        "roomCode",
        "selectedGame",
        "selectedGameId",
        "selectedRoundCount",
        "status",
        "visibility",
    ]);
    assert.deepEqual(Object.keys(response.lobby.players[0]).sort(), [
        "id",
        "isHost",
        "isInGame",
        "isReady",
        "name",
    ]);

    const serverSocket = harness.io.sockets.sockets.get(guest.transportId);
    assert.ok(serverSocket.rooms.has(createResponse.roomCode));
});

test("host selects a registered game and broadcasts authoritative metadata to all players", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest",
    });
    await emitWithAck(guest, "set-ready", { isReady: true });
    const revisionBeforeSelect = roomManager.createLobbyState(
        roomManager.getRoom(created.roomCode)
    ).revision;

    const hostUpdate = waitForLobby(
        host,
        (lobby) => lobby.selectedGameId === "fact-or-cap-anime"
    );
    const guestUpdate = waitForLobby(
        guest,
        (lobby) => lobby.selectedGameId === "fact-or-cap-anime"
    );
    const selectionResponse = await emitWithAck(host, "select-game", {
        gameId: "fact-or-cap-anime"
    });
    assert.equal(selectionResponse.selectedGameId, "fact-or-cap-anime");
    assert.equal(selectionResponse.lobby.selectedGameId, "fact-or-cap-anime");
    assert.equal(selectionResponse.lobby.revision, revisionBeforeSelect + 1);
    const [hostLobby, guestLobby] = await Promise.all([hostUpdate, guestUpdate]);
    assert.deepEqual(hostLobby, guestLobby);
    assert.equal(hostLobby.players[1].isReady, true);
    assert.deepEqual(selectionResponse.lobby, hostLobby);
    assert.deepEqual(hostLobby.selectedGame, {
        id: "fact-or-cap-anime",
        displayName: "Fact or Cap (Anime)",
        description: "A bluffing party game about surprising and verifiable anime facts.",
        minPlayers: 2,
        maxPlayers: roomManager.MAX_ROOM_CAPACITY,
        supportsRoundSelection: true
    });
    assert.deepEqual(hostLobby.availableGames.map(({ id }) => id), [
        "fact-or-cap",
        "fact-or-cap-anime",
        "bruh-wtf"
    ]);

    const hostGeneralUpdate = waitForLobby(
        host,
        (lobby) => lobby.selectedGameId === "fact-or-cap"
    );
    const guestGeneralUpdate = waitForLobby(
        guest,
        (lobby) => lobby.selectedGameId === "fact-or-cap"
    );
    const generalSelection = await emitWithAck(host, "select-game", {
        gameId: "fact-or-cap"
    });
    const [hostGeneralLobby, guestGeneralLobby] = await Promise.all([
        hostGeneralUpdate,
        guestGeneralUpdate
    ]);
    assert.equal(generalSelection.lobby.selectedGameId, "fact-or-cap");
    assert.equal(
        generalSelection.lobby.revision,
        selectionResponse.lobby.revision + 1
    );
    assert.deepEqual(hostGeneralLobby, guestGeneralLobby);
    assert.deepEqual(generalSelection.lobby, hostGeneralLobby);
    assert.equal(hostGeneralLobby.players[1].isReady, true);
    assert.deepEqual(hostGeneralLobby.selectedGame, {
        id: "fact-or-cap",
        displayName: "Fact or Cap",
        description: "A bluffing party game about surprising facts.",
        minPlayers: 2,
        maxPlayers: roomManager.MAX_ROOM_CAPACITY,
        supportsRoundSelection: true
    });
});

test("host round selections are validated, broadcast, and passed into the game", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    const joined = await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest"
    });
    assert.equal(joined.lobby.selectedRoundCount, 5);
    assert.equal(joined.lobby.readinessStatus, "waiting-for-ready");

    assert.equal((await emitWithAck(host, "select-round-count", {
        roundCount: 6,
        revision: joined.lobby.revision
    })).error.code, "INVALID_ROUND_COUNT");
    assert.equal((await emitWithAck(guest, "select-round-count", {
        roundCount: 7,
        revision: joined.lobby.revision
    })).error.code, "NOT_HOST");
    assert.equal((await emitWithAck(host, "select-round-count", {
        roundCount: 7,
        revision: joined.lobby.revision - 1
    })).error.code, "STALE_ROOM_STATE");
    assert.equal((await emitWithAck(host, "select-round-count", {
        roundCount: "7",
        revision: joined.lobby.revision
    })).error.code, "INVALID_ROUND_COUNT");
    assert.equal((await emitWithAck(host, "select-round-count", {
        roundCount: 7
    })).error.code, "INVALID_REQUEST");

    const readyLobby = waitForLobby(guest, (lobby) => lobby.readinessStatus === "ready");
    await emitWithAck(guest, "set-ready", { isReady: true });
    const guestReady = await readyLobby;
    const hostUpdate = waitForLobby(host, (lobby) => lobby.selectedRoundCount === 7);
    const guestUpdate = waitForLobby(guest, (lobby) => lobby.selectedRoundCount === 7);
    const selected = await emitWithAck(host, "select-round-count", {
        roundCount: 7,
        revision: guestReady.revision
    });
    assert.equal(selected.selectedRoundCount, 7);
    const [hostLobby, guestLobby] = await Promise.all([hostUpdate, guestUpdate]);
    assert.deepEqual(hostLobby, guestLobby);
    assert.equal(hostLobby.readinessStatus, "ready");
    assert.equal(hostLobby.players[1].isReady, true);

    const gameState = waitForGameState(host, (game) => game.state.phase === "question");
    const started = await emitWithAck(host, "start-game");
    assert.equal(started.game.state.totalRounds, 7);
    assert.equal((await gameState).state.totalRounds, 7);
});

test("the transferred host can update the authoritative round selection", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest"
    });

    const hostUpdate = waitForLobby(guest, (lobby) => lobby.playerCount === 1);
    await emitWithAck(host, "leave-room");
    const transferredLobby = await hostUpdate;
    assert.equal(transferredLobby.players[0].isHost, true);
    assert.equal(transferredLobby.selectedRoundCount, 5);
    const changed = await emitWithAck(guest, "select-round-count", {
        roundCount: 10,
        revision: transferredLobby.revision
    });
    assert.equal(changed.selectedRoundCount, 10);
    assert.equal(changed.lobby.selectedRoundCount, 10);
});

test("host can select Anime and complete a round through the shared socket game flow", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, {
        playerCount: 2,
        gameId: "fact-or-cap-anime",
        roundCount: 7
    });
    const sourceQuestion = animeQuestions.find(
        ({ text }) => text === game.questionState.state.prompt.text
    );
    assert.ok(sourceQuestion);
    assert.equal(questions.some(({ id }) => id === sourceQuestion.id), false);
    assert.equal(game.questionState.displayName, "Fact or Cap (Anime)");

    for (const [index, player] of [game.host, ...game.players].entries()) {
        const response = await emitWithAck(player, "fake-answer:submit", withRoundId(game.gameState, {
            completion: `Anime bluff ${index}`
        }));
        assert.deepEqual(response, { submitted: true, submissionCount: index + 1, playerCount: 2 });
    }
    const votingState = gameManager.getPublicGameState(game.roomCode, game.host.id);
    assert.equal(votingState.state.phase, "voting");
    for (const player of [game.host, ...game.players]) {
        const ownState = gameManager.getPublicGameState(game.roomCode, player.id);
        const option = ownState.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
        const response = await emitWithAck(player, "fake-answer:vote", withRoundId(ownState, {
            optionId: option.id
        }));
        assert.equal(response.voted, true);
    }
    const results = gameManager.getPublicGameState(game.roomCode, game.host.id);
    assert.equal(results.state.phase, "results");
    assert.equal(results.state.currentRound, 1);
    assert.equal(results.state.totalRounds, 7);
    assert.equal(results.state.results.players.length, 2);
    assert.equal(votingState.state.prompt.text, sourceQuestion.text);
});

test("Anime rematches retain the selected game and use only the Anime question bank", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, {
        playerCount: 4,
        gameId: "fact-or-cap-anime",
        visibility: "public"
    });
    const clients = [game.host, ...game.players];
    let roundState = game.gameState;

    for (let round = 1; round <= roundState.state.totalRounds; round += 1) {
        const resultStates = await completeSocketRound(game.host, game.players, roundState);
        assert.ok(animeQuestions.some(({ text }) => text === roundState.state.prompt.text));
        assert.equal(questions.some(({ text }) => text === roundState.state.prompt.text), false);
        if (round === roundState.state.totalRounds) {
            assert.equal(resultStates[0].status, "finished");
            break;
        }

        const nextSubmissionStates = clients.map((client) =>
            waitForGameState(
                client,
                (state) =>
                    state.gameId === "fact-or-cap-anime" &&
                    state.state.phase === "answer-submission" &&
                    state.state.currentRound === round + 1
            )
        );
        for (let index = 0; index < clients.length; index += 1) {
            const response = await emitWithAck(
                clients[index],
                "fake-answer:continue",
                withRoundId(resultStates[index], {})
            );
            assert.equal(response.advanced, index === clients.length - 1);
        }
        roundState = (await Promise.all(nextSubmissionStates))[0];
    }

    const resultViewerLobbyUpdates = Promise.all(game.players.map((player) =>
        waitForLobby(player, (state) => state.status === "lobby" && state.players.find(({ id }) => id === player.id)?.isInGame)
    ));
    assert.deepEqual((await emitWithAck(game.host, "subscribe-public-rooms", undefined)).rooms, []);
    const roomListedAfterReturn = waitForPublicRooms(game.host, (rooms) => rooms.length === 1);
    assert.deepEqual(
        await emitWithAck(game.host, "return-to-lobby", {
            sessionId: roundState.sessionId
        }),
        { returned: true }
    );
    const [returnedPublicRoom] = await roomListedAfterReturn;
    assert.equal(returnedPublicRoom.playerCount, 4);
    assert.equal(returnedPublicRoom.gameId, "fact-or-cap-anime");
    const deliveredToResultsViewers = await resultViewerLobbyUpdates;
    assert.equal(deliveredToResultsViewers.length, 3);
    assert.ok(deliveredToResultsViewers.every(({ playerCount, players, status }) =>
        status === "lobby" && playerCount === 1 && players.find(({ isHost }) => !isHost)?.isInGame
    ));
    const lobby = roomManager.createLobbyState(roomManager.getRoom(game.roomCode));
    assert.equal(lobby.selectedGameId, "fact-or-cap-anime");
    assert.equal(lobby.playerCount, 1);
    assert.ok(game.players.every(({ id }) => lobby.players.find((player) => player.id === id).isInGame));
    const guestLobbyEvents = [];
    game.players[0].on("lobby-state", (state) => guestLobbyEvents.push(state));
    const reminder = new Promise((resolve) => game.players[1].once("results-return-reminder", resolve));
    assert.deepEqual(await emitWithAck(game.host, "ask-results-viewers-to-return", {
        sessionId: roundState.sessionId
    }), { sent: 3 });
    assert.deepEqual(await reminder, { sessionId: roundState.sessionId });
    assert.equal((await emitWithAck(game.players[0], "set-ready", { isReady: true })).error.code, "PLAYER_VIEWING_RESULTS");
    const returnedGuestLobbyEvent = waitForLobby(game.players[0]);
    const hostLobbyUpdate = waitForLobby(game.host, (state) => state.playerCount === 2);
    assert.deepEqual(await emitWithAck(game.players[0], "return-from-results", {
        sessionId: roundState.sessionId
    }), { returned: true, status: "lobby" });
    const returnedLobby = await returnedGuestLobbyEvent;
    assert.deepEqual(await hostLobbyUpdate, returnedLobby);
    assert.equal(returnedLobby.playerCount, 2);
    assert.equal(returnedLobby.players.find(({ id }) => id === game.players[0].id).isInGame, false);
    assert.equal(
        (await emitWithAck(game.players[0], "set-ready", { isReady: true })).isReady,
        true
    );
    const staleViewerReminded = new Promise((resolve) => game.players[1].once("results-return-reminder", resolve));
    assert.deepEqual(await emitWithAck(game.host, "ask-results-viewers-to-return", {
        sessionId: roundState.sessionId
    }), { sent: 2 });
    assert.deepEqual(await staleViewerReminded, { sessionId: roundState.sessionId });
    const staleViewerStates = [];
    game.players[1].on("game-state", (state) => staleViewerStates.push(state));
    const replayHost = waitForGameState(game.host, (state) => state.gameId === "fact-or-cap-anime");
    const replayGuest = waitForGameState(game.players[0], (state) => state.gameId === "fact-or-cap-anime");
    const replay = await emitWithAck(game.host, "start-game");
    assert.equal(replay.starting, true);
    assert.equal(replay.game.gameId, "fact-or-cap-anime");
    assert.ok(animeQuestions.some(({ text }) => text === replay.game.state.prompt.text));
    assert.equal(questions.some(({ text }) => text === replay.game.state.prompt.text), false);
    const [newHostState, newGuestState] = await Promise.all([replayHost, replayGuest]);
    assert.equal(newHostState.sessionId, replay.game.sessionId);
    assert.equal(newGuestState.sessionId, replay.game.sessionId);
    assert.equal(staleViewerStates.length, 0);
    assert.equal((await emitWithAck(game.players[1], "fake-answer:submit", {
        completion: "stale viewer answer",
        sessionId: replay.game.sessionId,
        roundId: replay.game.state.roundId
    })).error.code, "NOT_A_GAME_PLAYER");
    const lateReturnLobbyEvent = waitForLobby(game.players[1]);
    assert.deepEqual(await emitWithAck(game.players[1], "return-from-results", {
        sessionId: roundState.sessionId
    }), { returned: true, status: "starting" });
    const lateReturnLobby = await lateReturnLobbyEvent;
    assert.equal(lateReturnLobby.status, "starting");
    assert.equal(lateReturnLobby.players.find(({ id }) => id === game.players[1].id).isInGame, false);
    assert.equal(roomManager.getRoom(game.roomCode).reminderSessionId, roundState.sessionId);
    assert.equal(guestLobbyEvents.length, 2);

    const secondMatchSessionId = replay.game.sessionId;
    let secondMatchRound = await waitForGameState(game.host, (state) =>
        state.sessionId === secondMatchSessionId && state.state.phase === "answer-submission"
    );
    for (let round = 1; round <= 5; round += 1) {
        const results = await completeSocketRound(game.host, [game.players[0]], secondMatchRound);
        if (round === 5) break;
        const nextStates = [game.host, game.players[0]].map((client) => waitForGameState(client, (state) =>
            state.sessionId === secondMatchSessionId && state.state.phase === "answer-submission" && state.state.currentRound === round + 1
        ));
        for (let index = 0; index < 2; index += 1) {
            const response = await emitWithAck([game.host, game.players[0]][index], "fake-answer:continue", withRoundId(results[index], {}));
            assert.equal(response.advanced, index === 1);
        }
        secondMatchRound = (await Promise.all(nextStates))[0];
    }
    const finalSecondMatchLobby = waitForLobby(game.players[1], (state) => state.status === "lobby");
    assert.deepEqual(await emitWithAck(game.host, "return-to-lobby", { sessionId: secondMatchSessionId }), { returned: true });
    const finalLobbyForLateReturner = await finalSecondMatchLobby;
    assert.equal(finalLobbyForLateReturner.playerCount, 2);
    assert.equal(finalLobbyForLateReturner.players.find(({ id }) => id === game.players[1].id).isInGame, false);
    assert.equal(finalLobbyForLateReturner.players.find(({ id }) => id === game.players[0].id).isInGame, true);
    assert.equal(finalLobbyForLateReturner.players.find(({ id }) => id === game.players[2].id).isInGame, true);
    const currentViewerReminder = new Promise((resolve) => game.players[0].once("results-return-reminder", resolve));
    assert.deepEqual(await emitWithAck(game.host, "ask-results-viewers-to-return", { sessionId: secondMatchSessionId }), { sent: 1 });
    await currentViewerReminder;
    const currentViewerLobby = waitForLobby(game.host, (state) => state.playerCount === 3);
    assert.deepEqual(await emitWithAck(game.players[0], "return-from-results", { sessionId: secondMatchSessionId }), {
        returned: true,
        status: "lobby"
    });
    await currentViewerLobby;
    assert.equal(roomManager.getRoom(game.roomCode).reminderSessionId, roundState.sessionId);
    const previousViewerReminder = new Promise((resolve) => game.players[2].once("results-return-reminder", resolve));
    assert.deepEqual(await emitWithAck(game.host, "ask-results-viewers-to-return", { sessionId: roundState.sessionId }), { sent: 1 });
    await previousViewerReminder;
    const previousViewerLobby = waitForLobby(game.host, (state) => state.playerCount === 4);
    assert.deepEqual(await emitWithAck(game.players[2], "return-from-results", { sessionId: roundState.sessionId }), {
        returned: true,
        status: "lobby"
    });
    await previousViewerLobby;
    assert.equal(roomManager.getRoom(game.roomCode).reminderSessionId, null);
    // The viewer also receives the host's return-to-lobby transition while
    // remaining on the immutable results snapshot.
    assert.equal(guestLobbyEvents.length, 5);
});

test("rejects invalid and non-host game selections without mutating the lobby", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest",
    });
    await emitWithAck(guest, "set-ready", { isReady: true });

    assert.equal(
        (await emitWithAck(guest, "select-game", { gameId: "fact-or-cap" })).error.code,
        "NOT_HOST"
    );
    assert.equal(
        (await emitWithAck(host, "select-game", { gameId: "not-registered" })).error.code,
        "GAME_NOT_FOUND"
    );
    assert.equal(
        (await emitWithAck(host, "select-game", { gameId: "fact-or-cap", displayName: "Injected" })).error.code,
        "INVALID_REQUEST"
    );
    assert.equal(roomManager.getRoom(created.roomCode).selectedGameId, "fact-or-cap");
    assert.equal(roomManager.getRoom(created.roomCode).players[1].isReady, true);
});

test("rejects invalid room codes", async (context) => {
    const harness = await createHarness(context);
    const client = await harness.connect();

    for (const roomCode of ["NONE", "BAD!"]) {
        const response = await emitWithAck(client, "join-room", {
            roomCode,
            playerName: "Guest",
        });
        assert.equal(response.error.code, "ROOM_NOT_FOUND");
        assert.equal(typeof response.error.message, "string");
    }
});

test("allows exactly eight players to join a room and rejects later joins", async (context) => {
    const harness = await createHarness(context);
    const players = [];
    for (let index = 0; index < 10; index += 1) {
        players.push(await harness.connect());
    }

    const createResponse = await emitWithAck(players[0], "create-room", {
        playerName: "Player 0",
    });
    harness.trackRoom(createResponse.roomCode);

    for (let index = 1; index < roomManager.MAX_ROOM_CAPACITY; index += 1) {
        const response = await emitWithAck(players[index], "join-room", {
            roomCode: createResponse.roomCode,
            playerName: `Player ${index}`,
        });
        assert.equal(response.lobby.playerCount, index + 1);
    }
    for (let index = roomManager.MAX_ROOM_CAPACITY; index < players.length; index += 1) {
        const response = await emitWithAck(players[index], "join-room", {
            roomCode: createResponse.roomCode,
            playerName: `Player ${index}`,
        });
        assert.equal(response.error.code, "ROOM_FULL");
        assert.equal(roomManager.getPlayerRoom(players[index].id), null);
    }
    assert.equal(roomManager.getRoom(createResponse.roomCode).players.length, roomManager.MAX_ROOM_CAPACITY);
});

test("rejects invalid or empty player names on create and join", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const invalidCreator = await harness.connect();
    const createResponse = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(createResponse.roomCode);

    for (const playerName of ["", "   ", "x".repeat(21), 123]) {
        const response = await emitWithAck(guest, "join-room", {
            roomCode: createResponse.roomCode,
            playerName,
        });
        assert.equal(response.error.code, "INVALID_NAME");
        assert.equal(typeof response.error.message, "string");
    }

    const invalidCreateResponse = await emitWithAck(invalidCreator, "create-room", {
        playerName: " ",
    });
    assert.equal(invalidCreateResponse.error.code, "INVALID_NAME");
});

test("room joining reserves names through disconnect grace and releases them after expiry or leave", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const firstJoiner = await harness.connect();
    const secondJoiner = await harness.connect();
    const replacement = await harness.connect();
    const leaver = await harness.connect();
    const leaveReplacement = await harness.connect();
    const otherRoomHost = await harness.connect();

    const created = await emitWithAck(host, "create-room", { playerName: "Alex" });
    assert.equal(created.error, undefined);
    harness.trackRoom(created.roomCode);
    const otherRoom = await emitWithAck(otherRoomHost, "create-room", { playerName: "alex" });
    assert.equal(otherRoom.error, undefined, "names are scoped to a room");
    harness.trackRoom(otherRoom.roomCode);

    const duplicate = await emitWithAck(firstJoiner, "join-room", {
        roomCode: created.roomCode,
        playerName: "  aLeX  "
    });
    assert.equal(duplicate.error.code, "DUPLICATE_PLAYER_NAME");
    assert.match(duplicate.error.message, /choose another name/i);
    assert.equal(roomManager.getRoom(created.roomCode).players.length, 1);

    const simultaneous = await Promise.all([
        emitWithAck(firstJoiner, "join-room", { roomCode: created.roomCode, playerName: "Shared" }),
        emitWithAck(secondJoiner, "join-room", { roomCode: created.roomCode, playerName: " shared " })
    ]);
    assert.equal(simultaneous.filter(({ error }) => !error).length, 1);
    assert.equal(simultaneous.filter(({ error }) => error?.code === "DUPLICATE_PLAYER_NAME").length, 1);
    assert.equal(roomManager.getRoom(created.roomCode).players.length, 2);

    const winningClient = simultaneous[0].error ? secondJoiner : firstJoiner;
    const offline = waitForLobby(host, (lobby) =>
        lobby.playerCount === 2 &&
        lobby.players.some(({ id, connected }) => id === winningClient.id && connected === false)
    );
    winningClient.disconnect();
    await offline;
    assert.equal((await emitWithAck(replacement, "join-room", {
        roomCode: created.roomCode,
        playerName: "SHARED"
    })).error.code, "DUPLICATE_PLAYER_NAME");
    const afterExpiry = waitForLobby(host, (lobby) => lobby.playerCount === 1);
    await harness.advanceGrace();
    await afterExpiry;
    const reusedAfterDisconnect = await emitWithAck(replacement, "join-room", {
        roomCode: created.roomCode,
        playerName: "SHARED"
    });
    assert.equal(reusedAfterDisconnect.error, undefined);

    assert.equal((await emitWithAck(leaver, "join-room", {
        roomCode: created.roomCode,
        playerName: "Temporary"
    })).error, undefined);
    assert.deepEqual(await emitWithAck(leaver, "leave-room"), { left: true });
    assert.equal((await emitWithAck(leaveReplacement, "join-room", {
        roomCode: created.roomCode,
        playerName: " temporary "
    })).error, undefined);
});

test("rejects a socket already in a room from joining another room", async (context) => {
    const harness = await createHarness(context);
    const firstPlayer = await harness.connect();
    const secondPlayer = await harness.connect();
    const firstRoom = await emitWithAck(firstPlayer, "create-room", {
        playerName: "First",
    });
    const secondRoom = await emitWithAck(secondPlayer, "create-room", {
        playerName: "Second",
    });
    harness.trackRoom(firstRoom.roomCode);
    harness.trackRoom(secondRoom.roomCode);

    const response = await emitWithAck(firstPlayer, "join-room", {
        roomCode: secondRoom.roomCode,
        playerName: "First",
    });
    assert.equal(response.error.code, "ALREADY_IN_ROOM");
    assert.equal(roomManager.getRoom(secondRoom.roomCode).players.length, 1);
});

test("leaving removes the player, broadcasts the update, and preserves the original host", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const createResponse = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(createResponse.roomCode);
    await emitWithAck(guest, "join-room", {
        roomCode: createResponse.roomCode,
        playerName: "Guest",
    });

    const updateEvent = waitForLobby(host, (lobby) => lobby.playerCount === 1);
    const response = await emitWithAck(guest, "leave-room");
    assert.deepEqual(response, { left: true });
    const updatedLobby = await updateEvent;
    assert.deepEqual(updatedLobby.players, [
        { id: host.id, name: "Host", isHost: true, isReady: false, isInGame: false },
    ]);
    assert.equal(updatedLobby.playerCount, 1);
    assert.equal(roomManager.getPlayerRoom(guest.id), null);
});

test("leaving deletes a room when the last player leaves", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);

    assert.deepEqual(await emitWithAck(host, "leave-room"), { left: true });
    assert.equal(roomManager.getRoom(created.roomCode), null);
    assert.equal(roomManager.getPlayerRoom(host.id), null);
});

test("malformed Socket.IO payloads return errors without crashing the server", async (context) => {
    const harness = await createHarness(context);
    const client = await harness.connect();

    for (const payload of [null, [], "not-an-object"]) {
        const response = await emitWithAck(client, "join-room", payload);
        assert.equal(response.error.code, "INVALID_REQUEST");
    }
    const createResponse = await emitWithAck(client, "create-room", {});
    assert.equal(createResponse.error.code, "INVALID_NAME");

    const validResponse = await emitWithAck(client, "create-room", {
        playerName: "Still connected",
    });
    assert.match(validResponse.roomCode, /^[A-Z]{4}$/);
    harness.trackRoom(validResponse.roomCode);
});

test("removes a newly created room when the creator socket cannot join it", async (context) => {
    const harness = await createHarness(context);
    const client = await harness.connect();
    const serverSocket = harness.io.sockets.sockets.get(client.transportId);
    assert.ok(serverSocket);

    let createdRoom;
    const originalCreateRoom = roomManager.createRoom;
    roomManager.createRoom = (playerId, playerName) => {
        createdRoom = originalCreateRoom(playerId, playerName);
        return createdRoom;
    };
    const originalJoin = serverSocket.join.bind(serverSocket);
    serverSocket.join = () => Promise.reject(new Error("simulated socket join failure"));
    const originalConsoleError = console.error;
    console.error = () => {};
    let response;
    try {
        response = await emitWithAck(client, "create-room", {
            playerName: "Host",
        });
    } finally {
        console.error = originalConsoleError;
        roomManager.createRoom = originalCreateRoom;
        serverSocket.join = originalJoin;
    }

    assert.ok(createdRoom);
    assert.equal(response.error.code, "INTERNAL_ERROR");
    assert.equal(roomManager.getRoom(createdRoom.code), null);
});

test("a failed asynchronous room join cancels grace state but preserves the guest identity", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    const serverSocket = harness.io.sockets.sockets.get(guest.transportId);
    assert.ok(serverSocket);

    let startJoining;
    const joining = new Promise((resolve) => {
        startJoining = resolve;
    });
    let rejectJoin;
    const originalJoin = serverSocket.join.bind(serverSocket);
    serverSocket.join = (roomCode) => {
        if (roomCode !== created.roomCode) return originalJoin(roomCode);
        return new Promise((_resolve, reject) => {
            rejectJoin = reject;
            startJoining();
        });
    };

    guest.emit("join-room", { roomCode: created.roomCode, playerName: "Guest" }, () => {});
    await joining;
    const disconnected = new Promise((resolve) => serverSocket.once("disconnect", resolve));
    guest.disconnect();
    await disconnected;
    assert.equal(harness.io.disconnectGraceManager.size, 1);
    assert.equal(roomManager.getPlayerRoom(guest.id).code, created.roomCode);

    rejectJoin(new roomManager.RoomError("SIMULATED_JOIN_FAILURE", "Join failed."));
    await new Promise((resolve) => setImmediate(resolve));
    serverSocket.join = originalJoin;
    assert.equal(roomManager.getPlayerRoom(guest.id), null);
    assert.equal(harness.io.disconnectGraceManager.size, 0);

    const recovered = await harness.connect({ storage: guest.recoveryStorage });
    assert.equal(recovered.id, guest.id);
    assert.deepEqual(
        await emitWithAck(recovered, "restore-session"),
        { status: "no-room", playerId: guest.id },
    );
    const nextRoom = await emitWithAck(recovered, "create-room", { playerName: "Guest" });
    assert.equal(nextRoom.error, undefined);
    harness.trackRoom(nextRoom.roomCode);
});

test("a stale room-join failure cannot remove a recovered player's restored membership", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    const serverSocket = harness.io.sockets.sockets.get(guest.transportId);
    assert.ok(serverSocket);

    let startJoining;
    const joining = new Promise((resolve) => {
        startJoining = resolve;
    });
    let rejectJoin;
    const originalJoin = serverSocket.join.bind(serverSocket);
    serverSocket.join = (roomCode) => {
        if (roomCode !== created.roomCode) return originalJoin(roomCode);
        return new Promise((_resolve, reject) => {
            rejectJoin = reject;
            startJoining();
        });
    };

    guest.emit("join-room", { roomCode: created.roomCode, playerName: "Guest" }, () => {});
    await joining;
    const recovered = await disconnectAndRecover(harness, guest);
    const restored = await emitWithAck(recovered, "restore-session");
    assert.equal(restored.status, "restored");
    assert.equal(harness.io.guestIdentityManager.getSocketId(guest.id), recovered.transportId);

    rejectJoin(new roomManager.RoomError("SIMULATED_JOIN_FAILURE", "Join failed."));
    await new Promise((resolve) => setImmediate(resolve));
    serverSocket.join = originalJoin;

    assert.equal(roomManager.getPlayerRoom(guest.id).code, created.roomCode);
    assert.equal(roomManager.getRoom(created.roomCode).players.length, 2);
    assert.equal(harness.io.disconnectGraceManager.size, 0);
});

test("a delayed room-join failure cannot remove a guest from a different room", async (context) => {
    const harness = await createHarness(context);
    const firstHost = await harness.connect();
    const secondHost = await harness.connect();
    const guest = await harness.connect();
    const firstRoom = await emitWithAck(firstHost, "create-room", { playerName: "First host" });
    const secondRoom = await emitWithAck(secondHost, "create-room", { playerName: "Second host" });
    harness.trackRoom(firstRoom.roomCode);
    harness.trackRoom(secondRoom.roomCode);
    const serverSocket = harness.io.sockets.sockets.get(guest.transportId);
    assert.ok(serverSocket);

    let startJoining;
    const joining = new Promise((resolve) => {
        startJoining = resolve;
    });
    let rejectJoin;
    const originalJoin = serverSocket.join.bind(serverSocket);
    serverSocket.join = (roomCode) => {
        if (roomCode !== firstRoom.roomCode) return originalJoin(roomCode);
        return new Promise((_resolve, reject) => {
            rejectJoin = reject;
            startJoining();
        });
    };

    guest.emit("join-room", { roomCode: firstRoom.roomCode, playerName: "Guest" }, () => {});
    await joining;
    assert.deepEqual(await emitWithAck(guest, "leave-room"), { left: true });
    assert.equal(
        (await emitWithAck(guest, "join-room", {
            roomCode: secondRoom.roomCode,
            playerName: "Guest",
        })).error,
        undefined,
    );

    rejectJoin(new roomManager.RoomError("SIMULATED_JOIN_FAILURE", "Join failed."));
    await new Promise((resolve) => setImmediate(resolve));
    serverSocket.join = originalJoin;

    assert.equal(roomManager.getPlayerRoom(guest.id).code, secondRoom.roomCode);
    assert.equal(roomManager.getRoom(firstRoom.roomCode).players.length, 1);
    assert.equal(roomManager.getRoom(secondRoom.roomCode).players.length, 2);
});

test("disconnect reserves a player seat and expiry removes the player", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const createResponse = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(createResponse.roomCode);
    const hostSocket = harness.io.sockets.sockets.get(host.transportId);
    await emitWithAck(guest, "join-room", {
        roomCode: createResponse.roomCode,
        playerName: "Guest",
    });

    const disconnectedLobbyUpdate = waitForLobby(host, (lobby) =>
        lobby.playerCount === 2 &&
        lobby.players.some(({ id, connected }) => id === guest.id && connected === false)
    );
    const disconnected = new Promise((resolve) =>
        harness.io.sockets.sockets.get(guest.transportId).once("disconnect", resolve)
    );
    guest.disconnect();
    await disconnected;
    const disconnectedLobby = await disconnectedLobbyUpdate;
    assert.equal(disconnectedLobby.players.find(({ id }) => id === guest.id).isHost, false);
    assert.equal(roomManager.getPlayerRoom(guest.id).code, createResponse.roomCode);
    assert.equal(roomManager.getRoom(createResponse.roomCode).players.length, 2);
    assert.ok(hostSocket.rooms.has(createResponse.roomCode));

    const lobbyUpdate = waitForLobby(host, (lobby) => lobby.playerCount === 1);
    await harness.advanceGrace(DISCONNECT_GRACE_PERIOD_MS - 1);
    assert.equal(roomManager.getPlayerRoom(guest.id).code, createResponse.roomCode);
    assert.equal(harness.io.disconnectGraceManager.size, 1);
    await harness.advanceGrace(1);
    const lobby = await lobbyUpdate;
    assert.deepEqual(lobby.players, [
        { id: host.id, name: "Host", isHost: true, isReady: false, isInGame: false },
    ]);
    assert.equal(roomManager.getPlayerRoom(guest.id), null);
    assert.equal(roomManager.getRoom(createResponse.roomCode).players.length, 1);
});

test("disconnect deletes a room only after every member's grace period expires", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const response = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(response.roomCode);
    await emitWithAck(guest, "join-room", { roomCode: response.roomCode, playerName: "Guest" });
    const disconnected = [host, guest].map((client) =>
        new Promise((resolve) =>
            harness.io.sockets.sockets.get(client.transportId).once("disconnect", resolve)
        )
    );
    host.disconnect();
    guest.disconnect();
    await Promise.all(disconnected);

    assert.equal(roomManager.getRoom(response.roomCode).players.length, 2);
    assert.equal(harness.io.disconnectGraceManager.size, 2);
    await harness.advanceGrace();
    assert.equal(roomManager.getRoom(response.roomCode), null);
    assert.equal(roomManager.getPlayerRoom(host.id), null);
    assert.equal(harness.io.disconnectGraceManager.size, 0);

    const recovered = await harness.connect({ storage: host.recoveryStorage });
    assert.equal(recovered.id, host.id);
    assert.equal(roomManager.getPlayerRoom(host.id), null);
    const replacementRoom = await emitWithAck(recovered, "create-room", { playerName: "Host again" });
    assert.equal(replacementRoom.error, undefined);
    harness.trackRoom(replacementRoom.roomCode);
});

test("the host can immediately kick a disconnected player and cancel their timer", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const target = await harness.connect();
    const observer = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    await emitWithAck(target, "join-room", { roomCode: created.roomCode, playerName: "Target" });
    await emitWithAck(observer, "join-room", { roomCode: created.roomCode, playerName: "Observer" });

    const targetOffline = waitForLobby(host, (lobby) =>
        lobby.players.some(({ id, connected }) => id === target.id && connected === false)
    );
    const disconnected = new Promise((resolve) =>
        harness.io.sockets.sockets.get(target.transportId).once("disconnect", resolve)
    );
    target.disconnect();
    await disconnected;
    await targetOffline;

    const targetRemoved = waitForLobby(observer, (lobby) =>
        !lobby.players.some(({ id }) => id === target.id)
    );
    assert.deepEqual(await emitWithAck(host, "kick-player", { targetPlayerId: target.id }), {
        kicked: true,
        playerId: target.id
    });
    await targetRemoved;
    assert.equal(roomManager.getPlayerRoom(target.id), null);
    assert.equal(harness.io.disconnectGraceManager.size, 0);
    await harness.advanceGrace();
    assert.equal(roomManager.getRoom(created.roomCode).players.length, 2);

    const recovered = await harness.connect({ storage: target.recoveryStorage });
    assert.equal(recovered.id, target.id);
    assert.deepEqual(await emitWithAck(recovered, "restore-session"), {
        status: "no-room",
        playerId: target.id,
    });
    const otherHost = await harness.connect();
    const otherRoom = await emitWithAck(otherHost, "create-room", { playerName: "Other host" });
    harness.trackRoom(otherRoom.roomCode);
    const joined = await emitWithAck(recovered, "join-room", {
        roomCode: otherRoom.roomCode,
        playerName: "Returning target",
    });
    assert.equal(joined.error, undefined);
    assert.equal(joined.lobby.players.some(({ id }) => id === target.id), true);
});

test("host disconnect migrates host to the earliest remaining player", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const nextHost = await harness.connect();
    const lastPlayer = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Original host",
    });
    harness.trackRoom(created.roomCode);
    await emitWithAck(nextHost, "join-room", {
        roomCode: created.roomCode,
        playerName: "Next host",
    });
    await emitWithAck(lastPlayer, "join-room", {
        roomCode: created.roomCode,
        playerName: "Last player",
    });
    const disconnectedUpdate = waitForLobby(nextHost, (lobby) =>
        lobby.playerCount === 3 &&
        lobby.players.some(({ id, connected }) => id === host.id && connected === false)
    );
    const disconnected = new Promise((resolve) =>
        harness.io.sockets.sockets.get(host.transportId).once("disconnect", resolve)
    );
    host.disconnect();
    await disconnected;

    await disconnectedUpdate;
    assert.equal(roomManager.getRoom(created.roomCode).hostId, host.id);
    const hostUpdate = waitForLobby(nextHost, (lobby) => lobby.playerCount === 2);
    const lastPlayerUpdate = waitForLobby(lastPlayer, (lobby) => lobby.playerCount === 2);
    await harness.advanceGrace();
    const lobby = await hostUpdate;
    assert.deepEqual(await lastPlayerUpdate, lobby);
    assert.equal(lobby.players[0].id, nextHost.id);
    assert.equal(lobby.players[0].isHost, true);
    assert.equal(lobby.players.some((player) => player.isHost), true);
    assert.equal(roomManager.getRoom(created.roomCode).hostId, nextHost.id);
});

test("disconnect suspends current-round actions while retaining game membership through grace expiry", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 3 });
    const originalHostSocket = harness.io.sockets.sockets.get(game.host.transportId);
    const room = roomManager.getRoom(game.roomCode);
    const originalSessionId = game.gameState.sessionId;
    const disconnectedUpdate = waitForGameState(
        game.players[0],
        (state) => state.sessionId === originalSessionId &&
            state.state.playerCount === 2 &&
            state.players.some(({ id, connected }) => id === game.host.id && connected === false)
    );
    const disconnected = new Promise((resolve) =>
        originalHostSocket.once("disconnect", resolve)
    );

    game.host.disconnect();
    await disconnected;
    const disconnectedState = await disconnectedUpdate;
    assert.equal(disconnectedState.status, "active");
    assert.equal(disconnectedState.state.playerCount, 2);
    assert.equal(disconnectedState.players.some(({ id }) => id === game.host.id), true);
    assert.equal(room.hostId, game.host.id);
    assert.equal(room.players.length, 3);
    const suspendedState = gameManager.getPublicGameState(game.roomCode, game.host.id).state;
    assert.equal(suspendedState.playerCount, 2);
    assert.equal(suspendedState.viewerIsSpectator, true);

    const activeUpdate = waitForGameState(
        game.players[0],
        (state) => state.sessionId === originalSessionId &&
            state.state.playerCount === 2 &&
            !state.players.some(({ id }) => id === game.host.id)
    );
    await harness.advanceGrace();
    const active = await activeUpdate;
    assert.equal(active.roomCode, game.roomCode);
    assert.equal(active.sessionId, originalSessionId);
    assert.equal(active.status, "active");
    assert.equal(active.state.playerCount, 2);
    assert.equal(active.players.some(({ id }) => id === game.host.id), false);
    assert.equal(roomManager.getRoom(game.roomCode), room);
    assert.equal(room.hostId, game.players[0].id);
    assert.equal(room.players.length, 2);
    assert.equal(roomManager.getPlayerRoom(game.host.id), null);
    assert.throws(
        () => roomManager.setPlayerReady(game.host.id, true),
        { code: "NOT_IN_ROOM" }
    );
    assert.throws(() => gameManager.getPublicGameState(game.roomCode, game.host.id), { code: "NOT_A_GAME_PLAYER" });
    assert.equal(gameManager.getPublicGameState(game.roomCode, game.players[0].id).state.playerCount, 2);
    const lobbyUpdate = waitForLobby(game.players[1], (lobby) => lobby.status === "lobby" && lobby.playerCount === 1);
    assert.deepEqual(await emitWithAck(game.players[0], "leave-room"), { left: true });
    const lobby = await lobbyUpdate;
    assert.equal(lobby.players[0].id, game.players[1].id);
    assert.equal(lobby.players[0].isHost, true);
    assert.equal(lobby.players[0].isReady, false);
    assert.throws(() => gameManager.getPublicGameState(game.roomCode, game.players[1].id), { code: "GAME_NOT_ACTIVE" });
    await emitWithAck(game.players[1], "leave-room");
    assert.equal(roomManager.getRoom(game.roomCode), null);
    assert.throws(() => gameManager.getPublicGameState(game.roomCode, game.players[1].id), { code: "GAME_NOT_ACTIVE" });
});

test("reconnecting during the grace period restores the same active game session", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 3 });
    const sessionId = game.gameState.sessionId;
    const originalSocket = harness.io.sockets.sockets.get(game.host.transportId);
    const offlineUpdate = waitForGameState(game.players[0], (state) =>
        state.sessionId === sessionId &&
        state.state.playerCount === 2 &&
        state.players.some(({ id, connected }) => id === game.host.id && connected === false)
    );
    const disconnected = new Promise((resolve) => originalSocket.once("disconnect", resolve));
    game.host.disconnect();
    await disconnected;
    await offlineUpdate;
    await harness.advanceGrace(DISCONNECT_GRACE_PERIOD_MS - 1);

    const onlineUpdate = waitForGameState(game.players[0], (state) =>
        state.sessionId === sessionId &&
        state.state.playerCount === 2 &&
        !state.players.some(({ id, connected }) => id === game.host.id && connected === false)
    );
    const recovered = await harness.connect({ storage: game.host.recoveryStorage });
    assert.equal(recovered.id, game.host.id);
    const restored = await onlineUpdate;
    assert.equal(restored.roomCode, game.roomCode);
    assert.equal(restored.state.phase, game.gameState.state.phase);
    assert.equal(harness.io.disconnectGraceManager.size, 0);

    await harness.advanceGrace(1);
    assert.equal(roomManager.getPlayerRoom(game.host.id).code, game.roomCode);
    assert.equal(gameManager.getPublicGameState(game.roomCode, game.host.id).sessionId, sessionId);
    assert.equal(gameManager.getPublicGameState(game.roomCode, game.host.id).state.viewerIsSpectator, true);
});

test("reconnected Fact-or-Cap players spectate the current round and regain actions next round", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 3 });
    const [host, guest, disconnectedPlayer] = [game.host, ...game.players];
    const { sessionId } = game.gameState;
    const { roundId } = game.gameState.state;

    const recovered = await disconnectAndRecover(harness, disconnectedPlayer);
    assert.equal(recovered.id, disconnectedPlayer.id);
    const restored = await emitWithAck(recovered, "restore-session");
    assert.equal(restored.status, "restored");
    assert.equal(restored.snapshot.game.state.viewerIsSpectator, true);

    const rejectedSubmission = await emitWithAck(recovered, "fake-answer:submit", {
        sessionId, roundId, completion: "Spectator answer"
    });
    assert.equal(rejectedSubmission.error.code, "SPECTATOR");

    for (const [client, text] of [[host, "Host active answer"], [guest, "Guest active answer"]]) {
        const response = await emitWithAck(client, "fake-answer:submit", {
            sessionId, roundId, completion: text
        });
        assert.equal(response.error, undefined);
    }

    const voting = gameManager.getPublicGameState(game.roomCode, host.id);
    assert.equal(voting.state.phase, "voting");
    for (const [client, otherText] of [
        [host, "Guest active answer"],
        [guest, "Host active answer"]
    ]) {
        const option = gameManager.getPublicGameState(game.roomCode, client.id).state.options
            .find(({ completion }) => completion === otherText);
        assert.ok(option);
        const response = await emitWithAck(client, "fake-answer:vote", {
            sessionId, roundId, optionId: option.id
        });
        assert.equal(response.error, undefined);
    }

    assert.equal(gameManager.getPublicGameState(game.roomCode, host.id).state.phase, "results");
    const rejectedContinue = await emitWithAck(recovered, "fake-answer:continue", { sessionId, roundId });
    assert.equal(rejectedContinue.error.code, "SPECTATOR");

    const nextRound = waitForGameState(recovered, (state) =>
        state.sessionId === sessionId &&
        state.state.roundId !== roundId &&
        state.state.phase === "answer-submission"
    );
    for (const client of [host, guest]) {
        assert.equal((await emitWithAck(client, "fake-answer:continue", { sessionId, roundId })).error, undefined);
    }

    const nextState = await nextRound;
    assert.equal(gameManager.getPublicGameState(game.roomCode, recovered.id).state.viewerIsSpectator, undefined);
    const activeSubmission = await emitWithAck(recovered, "fake-answer:submit", {
        sessionId,
        roundId: nextState.state.roundId,
        completion: "Active next-round answer"
    });
    assert.equal(activeSubmission.error, undefined);

    const firstCycle = await disconnectAndRecover(harness, recovered);
    const firstSnapshot = await emitWithAck(firstCycle, "restore-session");
    assert.equal(firstSnapshot.snapshot.game.state.viewerIsSpectator, true);
    assert.equal(firstSnapshot.snapshot.game.state.viewerSubmission, "Active next-round answer");
    const secondCycle = await disconnectAndRecover(harness, firstCycle);
    const secondSnapshot = await emitWithAck(secondCycle, "restore-session");
    assert.equal(secondSnapshot.snapshot.game.state.viewerIsSpectator, true);
    assert.equal(secondSnapshot.snapshot.game.state.viewerSubmission, "Active next-round answer");
    assert.equal(roomManager.getRoom(game.roomCode).players.length, 3);
    assert.equal(gameManager.getPublicGameState(game.roomCode, secondCycle.id).state.submissionCount, 1);
});

test("explicit leave during a game preserves the same session for remaining players", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 3 });
    const sessionId = game.gameState.sessionId;
    const update = waitForGameState(game.players[1], (state) => state.sessionId === sessionId && state.state.playerCount === 2);

    assert.deepEqual(await emitWithAck(game.players[0], "leave-room"), { left: true });
    const state = await update;
    assert.equal(state.status, "active");
    assert.equal(state.state.playerCount, 2);
    assert.equal(gameManager.getPublicGameState(game.roomCode, game.players[1].id).sessionId, sessionId);
});

test("Fact-or-Cap and Anime preserve current-round votes and answers across an explicit voting departure", async (context) => {
    const harness = await createHarness(context);
    for (const gameId of ["fact-or-cap", "fact-or-cap-anime"]) {
        const game = await startFakeAnswer(harness, { playerCount: 3, gameId });
        const clients = [game.host, ...game.players];
        const leaverId = game.host.id;
        const initial = game.gameState;
        for (let index = 0; index < clients.length; index += 1) {
            assert.equal((await emitWithAck(clients[index], "fake-answer:submit", withRoundId(initial, {
                completion: `departure ${gameId} answer ${index}`
            }))).error, undefined);
        }

        const hostVoting = gameManager.getPublicGameState(game.roomCode, game.host.id);
        const guestAnswer = hostVoting.state.options.find(({ completion }) => completion === `departure ${gameId} answer 1`);
        assert.ok(guestAnswer);
        assert.equal((await emitWithAck(game.host, "fake-answer:vote", withRoundId(hostVoting, {
            optionId: guestAnswer.id
        }))).voted, true);

        const departureUpdates = new Map(game.players.map((client) => [client.id, []]));
        const updateListeners = game.players.map((client) => {
            const listener = (state) => {
                if (state.sessionId === hostVoting.sessionId && state.state.playerCount === 2) {
                    departureUpdates.get(client.id).push(state);
                }
            };
            client.on("game-state", listener);
            return () => client.off("game-state", listener);
        });
        const departures = game.players.map((client) => waitForGameState(client, (state) =>
            state.sessionId === hostVoting.sessionId && state.state.phase === "voting" && state.state.playerCount === 2
        ));
        let postLeaveAction;
        if (gameId === "fact-or-cap") {
            assert.deepEqual(await emitWithAck(game.host, "leave-room"), { left: true });
            postLeaveAction = await emitWithAck(game.host, "fake-answer:vote", withRoundId(hostVoting, {
                optionId: guestAnswer.id
            }));
            const serverSocket = harness.io.sockets.sockets.get(harness.io.guestIdentityManager.getSocketId(leaverId));
            const disconnected = new Promise((resolve) => serverSocket.once("disconnect", resolve));
            game.host.disconnect();
            await disconnected;
        } else {
            const serverSocket = harness.io.sockets.sockets.get(game.host.transportId);
            const disconnected = new Promise((resolve) => serverSocket.once("disconnect", resolve));
            game.host.disconnect();
            await disconnected;
            await harness.advanceGrace();
        }
        const remainingStates = await Promise.all(departures);
        updateListeners.forEach((stop) => stop());
        assert.deepEqual([...departureUpdates.values()].map((updates) => updates.length), [1, 1]);
        assert.equal(roomManager.getPlayerRoom(leaverId), null);
        for (const state of remainingStates) {
            assert.equal(state.state.voteCount, 0);
            assert.deepEqual(state.state.voteProgress.map(({ playerId, voted }) => ({ playerId, voted })),
                game.players.map(({ id }) => ({ playerId: id, voted: false })));
            assert.equal(state.state.options.some((option) => Object.hasOwn(option, "authorId")), false);
            assert.equal(Object.hasOwn(state.state, "correctCompletion"), false);
            assert.ok(state.state.options.some(({ completion, isOwnAnswer }) =>
                completion === `departure ${gameId} answer 0` && !isOwnAnswer
            ));
        }

        const resultsEvents = game.players.map((client) => waitForGameState(client, (state) =>
            state.sessionId === hostVoting.sessionId && state.state.phase === "results"
        ));
        for (const client of game.players) {
            const own = gameManager.getPublicGameState(game.roomCode, client.id);
            const option = own.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
            assert.equal((await emitWithAck(client, "fake-answer:vote", withRoundId(own, {
                optionId: option.id
            }))).error, undefined);
        }
        for (const result of await Promise.all(resultsEvents)) {
            assert.equal(result.state.phase, "results");
            assert.equal(result.state.playerCount, 2);
            const preserved = result.state.results.options.find(({ authorId }) => authorId === leaverId);
            assert.ok(preserved, JSON.stringify({ gameId, hostId: leaverId, results: result.state.results.options }));
            assert.equal(preserved.completion, `departure ${gameId} answer 0`);
            const guestResult = result.state.results.options.find(({ authorId }) => authorId === game.players[0].id);
            assert.ok(guestResult.voters.some(({ name }) => name === "Host"));
        }
        if (postLeaveAction) assert.equal(postLeaveAction.error.code, "NOT_IN_ROOM");
    }
});

test("Fact-or-Cap variants reconcile completed submissions once when the last unsubmitted player leaves or disconnects", async (context) => {
    const harness = await createHarness(context);
    for (const gameId of ["fact-or-cap", "fact-or-cap-anime"]) {
        for (const departureType of ["leave", "disconnect"]) {
            const game = await startFakeAnswer(harness, { playerCount: 3, gameId });
            const [host, guest, leaver] = [game.host, ...game.players];
            const initial = game.gameState;
            const answers = [`${gameId} submitted host`, `${gameId} submitted guest`];
            for (const [client, completion] of [[host, answers[0]], [guest, answers[1]]]) {
                assert.equal((await emitWithAck(client, "fake-answer:submit", withRoundId(initial, { completion }))).error, undefined);
            }

            const phases = [[], []];
            const listeners = [host, guest].map((client, index) => {
                const listener = (state) => phases[index].push(state.state.phase);
                client.on("game-state", listener);
                return () => client.off("game-state", listener);
            });
            const reconciled = [host, guest].map((client) => waitForGameState(client, (state) =>
                state.sessionId === initial.sessionId && state.state.phase === "voting" && state.state.playerCount === 2
            ));
            const beginVotingActions = [];
            const originalPerformGameAction = gameManager.performGameAction;
            gameManager.performGameAction = function (...args) {
                if (args[3] === "begin-voting") {
                    beginVotingActions.push({ gameId: args[1], sessionId: args[6] });
                }
                return originalPerformGameAction.apply(this, args);
            };
            let states;
            try {
                if (departureType === "leave") {
                    assert.deepEqual(await emitWithAck(leaver, "leave-room"), { left: true });
                } else {
                    const serverSocket = harness.io.sockets.sockets.get(leaver.transportId);
                    const disconnected = new Promise((resolve) => serverSocket.once("disconnect", resolve));
                    leaver.disconnect();
                    await disconnected;
                    await harness.advanceGrace();
                }

                states = await Promise.all(reconciled);
                await new Promise((resolve) => setImmediate(resolve));
            } finally {
                gameManager.performGameAction = originalPerformGameAction;
            }
            listeners.forEach((stop) => stop());
            assert.deepEqual(
                beginVotingActions,
                departureType === "leave" ? [{ gameId, sessionId: initial.sessionId }] : []
            );
            for (const phaseList of phases) {
                assert.ok(
                    phaseList.length >= 1 && phaseList.every((phase) => phase === "voting"),
                    `${gameId} ${departureType} should broadcast the reconciled voting phase`
                );
            }
            assert.ok(states.every(({ state }) => state.options.length === 3));
            for (const answer of answers) {
                assert.ok(states.every(({ state }) => state.options.some(({ completion }) => completion === answer)));
            }
            assert.ok(states.every(({ state }) =>
                state.voteProgress.length === 2 &&
                state.voteProgress.every(({ playerId }) => playerId !== leaver.id)
            ));
            if (departureType === "leave") {
                assert.equal(roomManager.getPlayerRoom(leaver.id), null);
                assert.throws(() => gameManager.getPublicGameState(game.roomCode, leaver.id), { code: "NOT_A_GAME_PLAYER" });
            }

            const results = [host, guest].map((client) => waitForGameState(client, (state) =>
                state.sessionId === initial.sessionId && state.state.phase === "results"));
            for (const client of [host, guest]) {
                const current = gameManager.getPublicGameState(game.roomCode, client.id);
                const option = current.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
                assert.ok(option);
                await emitWithAck(client, "fake-answer:vote", withRoundId(current, { optionId: option.id }));
            }
            assert.ok((await Promise.all(results)).every(({ state }) => state.playerCount === 2 && state.phase === "results"));
            if (departureType === "leave") {
                const rejected = await emitWithAck(leaver, "fake-answer:submit", withRoundId(initial, { completion: "late" }));
                assert.equal(rejected.error.code, "NOT_IN_ROOM");
            }
        }
    }
});

test("Fact-or-Cap and Anime publish when the last active voter votes after an unvoted submitter disconnects", async (context) => {
    const harness = await createHarness(context);
    for (const gameId of ["fact-or-cap", "fact-or-cap-anime"]) {
        const game = await startFakeAnswer(harness, { playerCount: 3, gameId });
        const [host, voter, leaver] = [game.host, ...game.players];
        const leaverId = leaver.id;
        const initial = game.gameState;
        for (const [index, client] of [host, voter, leaver].entries()) {
            assert.equal((await emitWithAck(client, "fake-answer:submit", withRoundId(initial, {
                completion: `${gameId} retained answer ${index}`
            }))).error, undefined);
        }

        const voting = gameManager.getPublicGameState(game.roomCode, voter.id);
        const leaverOption = voting.state.options.find(({ completion }) => completion === `${gameId} retained answer 2`);
        assert.ok(leaverOption);
        assert.equal((await emitWithAck(voter, "fake-answer:vote", withRoundId(voting, {
            optionId: leaverOption.id
        }))).error, undefined);

        const remainingUpdates = [host, voter].map((client) => waitForGameState(client, (state) =>
            state.sessionId === voting.sessionId && state.state.phase === "voting" && state.state.playerCount === 2));
        const serverSocket = harness.io.sockets.sockets.get(harness.io.guestIdentityManager.getSocketId(leaverId));
        const disconnected = new Promise((resolve) => serverSocket.once("disconnect", resolve));
        leaver.disconnect();
        await disconnected;
        await harness.advanceGrace();
        const currentStates = await Promise.all(remainingUpdates);
        for (const current of currentStates) {
            assert.equal(current.state.voteCount, 1);
            assert.equal(current.state.voteProgress.some(({ playerId }) => playerId === leaverId), false);
            assert.equal(current.state.options.some((option) => Object.hasOwn(option, "authorId")), false);
            assert.equal(Object.hasOwn(current.state, "correctCompletion"), false);
            assert.ok(current.state.options.some(({ completion }) => completion === `${gameId} retained answer 2`));
        }

        const results = [host, voter].map((client) => waitForGameState(client, (state) =>
            state.sessionId === voting.sessionId && state.state.phase === "results"));
        const hostCurrent = gameManager.getPublicGameState(game.roomCode, host.id);
        const hostVote = hostCurrent.state.options.find(({ completion }) => completion === `${gameId} retained answer 1`);
        assert.ok(hostVote);
        const finalVote = await emitWithAck(host, "fake-answer:vote", withRoundId(hostCurrent, {
            optionId: hostVote.id
        }));
        assert.equal(finalVote.error, undefined);

        for (const result of await Promise.all(results)) {
            const departed = result.state.results.players.find(({ playerId }) => playerId === leaverId);
            const answer = result.state.results.options.find(({ authorId }) => authorId === leaverId);
            assert.equal(result.state.playerCount, 2);
            assert.equal(departed.submittedCompletion, `${gameId} retained answer 2`);
            assert.equal(departed.voteOptionId, null);
            assert.equal(departed.roundPoints, 1);
            assert.deepEqual(answer.voters.map(({ playerId }) => playerId), [voter.id]);
        }
    }
});

test("quick successive voting disconnects preserve both recorded votes and publish once to remaining clients", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 4, gameId: "fact-or-cap" });
    const [host, voter, leaverOne, leaverTwo] = [game.host, ...game.players];
    const leaverIds = [leaverOne.id, leaverTwo.id];
    const initial = game.gameState;
    const clients = [host, voter, leaverOne, leaverTwo];
    for (const [index, client] of clients.entries()) {
        assert.equal((await emitWithAck(client, "fake-answer:submit", withRoundId(initial, {
            completion: `quick departure answer ${index}`
        }))).error, undefined);
    }
    const voting = gameManager.getPublicGameState(game.roomCode, host.id);
    for (const [voterClient, answerIndex] of [[host, 2], [voter, 3]]) {
        const state = gameManager.getPublicGameState(game.roomCode, voterClient.id);
        const option = state.state.options.find(({ completion }) => completion === `quick departure answer ${answerIndex}`);
        assert.ok(option);
        assert.equal((await emitWithAck(voterClient, "fake-answer:vote", withRoundId(state, {
            optionId: option.id
        }))).error, undefined);
    }

    const results = [host, voter].map((client) => waitForGameState(client, (state) =>
        state.sessionId === voting.sessionId && state.state.phase === "results"));
    const serverSockets = [leaverOne, leaverTwo].map((client) =>
        harness.io.sockets.sockets.get(client.transportId),
    );
    const disconnected = serverSockets.map((socket) => new Promise((resolve) => socket.once("disconnect", resolve)));
    leaverOne.disconnect();
    leaverTwo.disconnect();
    await Promise.all(disconnected);
    await harness.advanceGrace();

    for (const result of await Promise.all(results)) {
        assert.equal(result.state.currentRound, voting.state.currentRound);
        assert.equal(result.state.phase, "results");
        assert.equal(result.state.playerCount, 2);
        assert.deepEqual(result.players.map(({ id }) => id).sort(), [
            host.id, voter.id, leaverOne.id, leaverTwo.id
        ].sort());
        assert.equal(result.players.find(({ id }) => id === leaverOne.id).connected, false);
        assert.equal(result.players.find(({ id }) => id === leaverTwo.id).connected, false);
        for (const [index, leaverId] of leaverIds.entries()) {
            const answer = result.state.results.options.find(({ authorId }) => authorId === leaverId);
            const player = result.state.results.players.find(({ playerId }) => playerId === leaverId);
            assert.equal(answer.completion, `quick departure answer ${index + 2}`);
            assert.equal(answer.voters.length, 1);
            assert.equal(player.voteOptionId, null);
            assert.equal(player.roundPoints, 1);
        }
    }
    assert.deepEqual(roomManager.getRoom(game.roomCode).players.map(({ id }) => id).sort(), [host.id, voter.id].sort());
});

test("host leaving migrates host to the earliest remaining player", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const nextHost = await harness.connect();
    const lastPlayer = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Original host",
    });
    harness.trackRoom(created.roomCode);
    await emitWithAck(nextHost, "join-room", {
        roomCode: created.roomCode,
        playerName: "Next host",
    });
    await emitWithAck(lastPlayer, "join-room", {
        roomCode: created.roomCode,
        playerName: "Last player",
    });

    const nextHostUpdate = waitForLobby(nextHost, (lobby) => lobby.playerCount === 2);
    const lastPlayerUpdate = waitForLobby(lastPlayer, (lobby) => lobby.playerCount === 2);
    assert.deepEqual(await emitWithAck(host, "leave-room"), { left: true });
    const lobby = await nextHostUpdate;
    assert.deepEqual(await lastPlayerUpdate, lobby);
    assert.equal(lobby.players[0].id, nextHost.id);
    assert.equal(lobby.players[0].isHost, true);
    assert.equal(roomManager.getRoom(created.roomCode).hostId, nextHost.id);
    assert.equal(roomManager.getPlayerRoom(host.id), null);
});

test("players can toggle ready state and receive authoritative lobby updates", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest",
    });

    const hostReadyUpdate = waitForLobby(
        host,
        (lobby) => lobby.players.find((player) => player.id === guest.id)?.isReady
    );
    const guestReadyUpdate = waitForLobby(
        guest,
        (lobby) => lobby.players.find((player) => player.id === guest.id)?.isReady
    );
    assert.deepEqual(
        await emitWithAck(guest, "set-ready", { isReady: true }),
        { isReady: true }
    );
    const readyLobby = await hostReadyUpdate;
    assert.deepEqual(await guestReadyUpdate, readyLobby);
    assert.equal(
        roomManager.getRoom(created.roomCode).players.find((player) => player.id === guest.id)
            .isReady,
        true
    );

    const unreadyUpdate = waitForLobby(
        host,
        (lobby) => !lobby.players.find((player) => player.id === guest.id)?.isReady
    );
    await emitWithAck(guest, "set-ready", { isReady: false });
    assert.equal(
        (await unreadyUpdate).players.find((player) => player.id === guest.id).isReady,
        false
    );
});

test("rejects non-host start attempts and starting with fewer than two players", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    assert.equal(
        (await emitWithAck(host, "start-game")).error.code,
        "NOT_ENOUGH_PLAYERS"
    );

    await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest",
    });
    assert.equal((await emitWithAck(guest, "start-game")).error.code, "NOT_HOST");
});

test("host cannot start until all non-host players are ready", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    const guests = await joinPlayers(harness, created.roomCode, 3);

    const notReady = await emitWithAck(host, "start-game");
    assert.equal(notReady.error.code, "PLAYERS_NOT_READY");
    await emitWithAck(guests[0], "set-ready", { isReady: true });
    await emitWithAck(guests[1], "set-ready", { isReady: true });
    await emitWithAck(guests[2], "set-ready", { isReady: true });
    assert.equal(roomManager.getRoom(created.roomCode).players[0].isReady, false);
    const response = await emitWithAck(host, "start-game");
    assert.equal(response.starting, true);
    assert.equal(response.game.state.phase, "question");
});

test("host cannot start a game with only one player", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);

    const response = await emitWithAck(host, "start-game");
    assert.equal(response.error.code, "NOT_ENOUGH_PLAYERS");
    assert.equal(roomManager.getRoom(created.roomCode).status, "lobby");
});

test("failed game initialization rolls the room back and allows a clean retry", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    const [guest] = await joinPlayers(harness, created.roomCode, 1);
    await emitWithAck(guest, "set-ready", { isReady: true });

    const originalStart = factOrCapGame.start;
    factOrCapGame.start = () => {
        throw new Error("simulated question initialization failure");
    };
    try {
        const response = await emitWithAck(host, "start-game");
        assert.deepEqual(response.error, {
            code: "INTERNAL_ERROR",
            message: "The room operation could not be completed.",
        });
        assert.equal(roomManager.getRoom(created.roomCode).status, "lobby");
        assert.throws(
            () => gameManager.getPublicGameState(created.roomCode, host.id),
            { code: "GAME_NOT_ACTIVE" }
        );
    } finally {
        factOrCapGame.start = originalStart;
    }

    const retry = await emitWithAck(host, "start-game");
    assert.equal(retry.starting, true);
    assert.equal(retry.game.state.phase, "question");
    assert.ok(retry.game.state.prompt.text);
});

test("host can start when requirements are met and a second start is rejected", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    const guests = await joinPlayers(harness, created.roomCode, 3);
    for (const guest of guests) {
        await emitWithAck(guest, "set-ready", { isReady: true });
    }
    let startEventCount = 0;
    host.on("game-starting", () => {
        startEventCount += 1;
    });

    const hostStarting = new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("host game-starting event timed out")),
            3000
        );
        host.once("game-starting", (payload) => {
            clearTimeout(timeout);
            resolve(payload);
        });
    });
    const guestStarting = new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("guest game-starting event timed out")),
            3000
        );
        guests[0].once("game-starting", (payload) => {
            clearTimeout(timeout);
            resolve(payload);
        });
    });

    const concurrentStarts = await Promise.all([
        emitWithAck(host, "start-game"),
        emitWithAck(host, "start-game"),
    ]);
    assert.equal(concurrentStarts.filter((response) => response.starting).length, 1);
    assert.equal(
        concurrentStarts.filter(
            (response) => response.error?.code === "ROOM_NOT_IN_LOBBY"
        ).length,
        1
    );
    const hostPayload = await hostStarting;
    assert.deepEqual(await guestStarting, hostPayload);
    assert.equal(hostPayload.roomCode, created.roomCode);
    assert.equal(hostPayload.lobby.status, "starting");
    assert.equal(roomManager.getRoom(created.roomCode).status, "starting");
    assert.equal((await emitWithAck(host, "start-game")).error.code, "ROOM_NOT_IN_LOBBY");
    assert.equal(startEventCount, 1);
});

test("host starts the room-selected registered game and broadcasts its safe question state", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    const guests = await joinPlayers(harness, created.roomCode, 3);
    for (const guest of guests) {
        await emitWithAck(guest, "set-ready", { isReady: true });
    }

    const startFlows = [host, ...guests].map(waitForGameStart);
    const startResponse = await emitWithAck(host, "start-game");
    assert.equal(startResponse.starting, true);
    const receivedFlows = await Promise.all(startFlows);
    const { startingPayload, gameState: hostState } = receivedFlows[0];
    assert.equal(startingPayload.roomCode, created.roomCode);
    assert.equal(startingPayload.lobby.status, "starting");
    assert.equal(startingPayload.lobby.playerCount, 4);
    assert.equal(startingPayload.game.state.phase, "question");
    assert.equal(startingPayload.game.state.currentRound, 1);
    assert.ok(startingPayload.game.state.prompt.text);
    for (const flow of receivedFlows) {
        assert.deepEqual(flow.events, ["game-starting", "game-state"]);
        assert.deepEqual(flow.startingPayload, startingPayload);
        assert.deepEqual(flow.gameState, hostState);
    }
    assert.deepEqual(startResponse.game, hostState);
    assert.equal(hostState.roomCode, created.roomCode);
    assert.equal(hostState.gameId, "fact-or-cap");
    assert.equal(hostState.displayName, "Fact or Cap");
    assert.equal(hostState.status, "active");
    assert.equal(hostState.state.phase, "question");
    assert.equal(hostState.state.currentRound, 1);
    assert.equal(hostState.state.totalRounds, 5);
    assert.equal(hostState.state.prompt.text.length > 0, true);
    assert.deepEqual(
        hostState.players.map(({ id, name }) => ({ id, name })),
        [
            { id: host.id, name: "Host" },
            ...guests.map((guest, index) => ({ id: guest.id, name: `Guest ${index + 1}` })),
        ]
    );
    assert.ok(questions.length >= hostState.state.totalRounds);
    assert.ok(questions.some((question) => question.text === hostState.state.prompt.text));
    assert.deepEqual(Object.keys(hostState).sort(), [
        "displayName",
        "gameId",
        "players",
        "revision",
        "roomCode",
        "sessionId",
        "state",
        "status",
    ]);
    assert.deepEqual(Object.keys(hostState.state.prompt).sort(), ["id", "text"]);
    const selectedQuestion = questions.find(
        (question) => question.text === hostState.state.prompt.text
    );
    assert.ok(selectedQuestion);
    assertQuestionPrivateDataAbsent(hostState, selectedQuestion);
    assertQuestionPrivateDataAbsent(startingPayload, selectedQuestion);
    assertQuestionPrivateDataAbsent(startResponse.game, selectedQuestion);
    assert.equal((await emitWithAck(guests[0], "start-game")).error.code, "NOT_HOST");
});

test("clients cannot choose a game during start and malformed start payloads are rejected safely", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    const guests = await joinPlayers(harness, created.roomCode, 3);
    for (const guest of guests) {
        await emitWithAck(guest, "set-ready", { isReady: true });
    }

    assert.equal(
        (await emitWithAck(host, "start-game", { gameId: "fact-or-cap" })).error.code,
        "INVALID_REQUEST"
    );
    assert.equal((await emitWithAck(host, "start-game", null)).error.code, "INVALID_REQUEST");

    const hostGameState = waitForGameState(host);
    const guestGameState = waitForGameState(guests[0]);
    await emitWithAck(host, "start-game");
    const [hostState, guestState] = await Promise.all([hostGameState, guestGameState]);
    assert.deepEqual(hostState.state, guestState.state);
    assert.equal(hostState.gameId, "fact-or-cap");
});

test("game selection is rejected after the room leaves the lobby", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    const guests = await joinPlayers(harness, created.roomCode, 1);
    await emitWithAck(guests[0], "set-ready", { isReady: true });

    const startResponse = await emitWithAck(host, "start-game");
    assert.equal(startResponse.starting, true);
    assert.equal(
        (await emitWithAck(host, "select-game", { gameId: "fact-or-cap" })).error.code,
        "ROOM_NOT_IN_LOBBY"
    );
});

test("Fact-or-Cap opens submissions after the question state and rejects early submissions", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { waitForSubmission: false });

    assert.equal(game.questionState.state.phase, "question");
    assert.ok(game.questionState.state.prompt.text);
    const response = await emitWithAck(game.players[0], "fake-answer:submit", {
        ...withRoundId(game.questionState, { completion: "Too early" }),
    });
    assert.equal(response.error.code, "SUBMISSIONS_NOT_OPEN");
    assert.equal(
        (await emitWithAck(game.players[0], "fake-answer:vote", {
            optionId: "not-an-option",
            sessionId: game.questionState.sessionId,
            roundId: game.questionState.state.roundId,
        })).error.code,
        "VOTING_NOT_OPEN"
    );
    assert.equal(
        (await waitForGameState(
            game.host,
            (state) => state.state.phase === "answer-submission"
        )).state.submissionCount,
        0
    );
});

test("submission, voting, and continuation waits remain active without inactivity timeouts", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 2 });
    const room = roomManager.getRoom(game.roomCode);
    assert.ok(room);
    const originalPlayers = room.players.map(({ id, isReady }) => ({ id, isReady }));
    assert.equal(typeof factOrCapSocketHandlers.expireActionPhase, "undefined");
    assert.equal(room.status, "starting");
    assert.equal(
        gameManager.getPublicGameState(game.roomCode, game.host.id).state.phase,
        "answer-submission"
    );
    await emitWithAck(game.host, "fake-answer:submit", {
        ...withRoundId(game.gameState, {
            completion: "An answer that can wait.",
        }),
    });
    const voting = waitForGameState(
        game.host,
        (state) => state.state.phase === "voting"
    );
    const guestSubmissionState = gameManager.getPublicGameState(
        game.roomCode,
        game.players[0].id
    );
    await emitWithAck(game.players[0], "fake-answer:submit", {
        ...withRoundId(guestSubmissionState, {
            completion: "A second answer that can wait.",
        }),
    });
    const votingState = await voting;
    const hostOption = votingState.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
    assert.ok(hostOption);
    await emitWithAck(game.host, "fake-answer:vote", withRoundId(votingState, {
        optionId: hostOption.id,
    }));
    assert.equal(
        gameManager.getPublicGameState(game.roomCode, game.host.id).state.phase,
        "voting"
    );

    const results = waitForGameState(
        game.host,
        (state) => state.state.phase === "results"
    );
    const guestVotingState = gameManager.getPublicGameState(
        game.roomCode,
        game.players[0].id
    );
    await emitWithAck(game.players[0], "fake-answer:vote", withRoundId(guestVotingState, {
        optionId: guestVotingState.state.options.find(
            ({ isOwnAnswer }) => !isOwnAnswer
        ).id,
    }));
    const resultsState = await results;
    await emitWithAck(game.host, "fake-answer:continue", {
        sessionId: resultsState.sessionId,
        roundId: resultsState.state.roundId,
    });
    const waitingState = gameManager.getPublicGameState(game.roomCode, game.host.id);
    assert.equal(waitingState.state.phase, "results");
    assert.equal(waitingState.state.continueReadyCount, 1);
    assert.equal(room.status, "starting");
    assert.deepEqual(
        room.players.map(({ id, isReady }) => ({ id, isReady })),
        originalPlayers
    );
});

test("Fact-or-Cap submissions broadcast safe progress and enter reveal after all players submit", async (context) => {
    const harness = await createHarness(context);
    const { host, players, gameState } = await startFakeAnswer(harness);
    const clients = [host, ...players];
    const submittedCompletions = clients.map(
        (_, index) => `An invented completion from player ${index + 1}.`
    );

    assert.equal(gameState.state.phase, "answer-submission");
    assert.equal(gameState.state.submissionCount, 0);
    assert.equal(gameState.state.playerCount, clients.length);
    assert.deepEqual(Object.keys(gameState.state).sort(), [
        "currentRound",
        "phase",
        "playerCount",
        "prompt",
        "roundId",
        "submissionCount",
        "submissionProgress",
        "totalRounds",
    ]);
    assert.deepEqual(
        gameState.state.submissionProgress.map(
            ({ playerId, name, submitted }) => ({ playerId, name, submitted })
        ),
        gameState.players.map(({ id, name }) => ({
            playerId: id,
            name,
            submitted: false,
        }))
    );
    assert.ok(
        gameState.state.submissionProgress.every(
            (player) =>
                Object.keys(player).sort().join(",") === "name,playerId,submitted"
        )
    );

    const progressEvents = clients.map((client) =>
        waitForGameState(client, (state) => state.state.submissionCount === 1)
    );
    const firstResponse = await emitWithAck(players[0], "fake-answer:submit", {
        ...withRoundId(gameState, {
        completion: submittedCompletions[1],
        }),
    });
    assert.deepEqual(firstResponse, {
        submitted: true,
        submissionCount: 1,
        playerCount: clients.length,
    });
    const firstProgress = await Promise.all(progressEvents);
    for (let viewerIndex = 0; viewerIndex < firstProgress.length; viewerIndex += 1) {
        const state = firstProgress[viewerIndex];
        const sharedState = ({ viewerSubmission, ...publicState }) => publicState;
        assert.deepEqual(
            { ...state, state: sharedState(state.state) },
            { ...firstProgress[0], state: sharedState(firstProgress[0].state) }
        );
        assert.equal(state.state.phase, "answer-submission");
        assert.equal(
            state.state.submissionProgress.filter(({ submitted }) => submitted).length,
            1
        );
        assert.equal(
            state.state.submissionProgress.find(
                ({ playerId }) => playerId === players[0].id
            ).submitted,
            true
        );
        assert.equal(
            state.state.viewerSubmission,
            viewerIndex === 1 ? submittedCompletions[1] : undefined
        );
        const { stringValues } = collectPublicKeysAndStringValues(state);
        assert.equal(stringValues.includes(submittedCompletions[1]), viewerIndex === 1);
    }

    for (let index = 1; index < players.length; index += 1) {
        const response = await emitWithAck(players[index], "fake-answer:submit", {
            ...withRoundId(gameState, {
            completion: submittedCompletions[index + 1],
            }),
        });
        assert.equal(response.submissionCount, index + 1);
    }

    const selectedQuestion = questions.find(
        (question) => question.text === gameState.state.prompt.text
    );
    assert.ok(selectedQuestion);
    const completedEvents = clients.map((client) =>
        waitForGameState(client, (state) => state.state.phase === "reveal")
    );
    const votingEvents = clients.map((client) =>
        waitForGameState(client, (state) => state.state.phase === "voting")
    );
    const finalResponse = await emitWithAck(host, "fake-answer:submit", {
        ...withRoundId(gameState, {
        completion: submittedCompletions[0],
        }),
    });
    assert.deepEqual(finalResponse, {
        submitted: true,
        submissionCount: clients.length,
        playerCount: clients.length,
    });
    const revealStates = await Promise.all(completedEvents);
    for (let index = 0; index < revealStates.length; index += 1) {
        const state = revealStates[index];
        assert.equal(state.state.phase, "reveal");
        assert.equal(state.state.submissionCount, clients.length);
        assert.equal(state.state.options.length, clients.length + 1);
        assert.equal(
            state.state.options.find(
                ({ completion }) =>
                    completion === submittedCompletions[index]
            ).isOwnAnswer,
            true
        );
        assert.equal(
            state.state.options.some(
                ({ completion }) =>
                    completion === selectedQuestion.correctCompletion
            ),
            true
        );
        assert.ok(
            state.state.options.every(
                (option) =>
                    Object.keys(option).sort().join(",") ===
                    "completion,id,isOwnAnswer"
            )
        );
    }

    const votingStates = await Promise.all(votingEvents);
    for (const state of votingStates) {
        assert.equal(state.state.voteCount, 0);
        assert.equal(Object.hasOwn(state.state, "votes"), false);
        assert.equal(Object.hasOwn(state.state, "correctOptionId"), false);
    }
});

test("two-player Fact-or-Cap reveal shows the own answer without revealing authors and voting reaches results", async (context) => {
    const harness = await createHarness(context);
    const { host, players, questionState, gameState } = await startFakeAnswer(
        harness,
        { playerCount: 2 }
    );
    const clients = [host, ...players];

    assert.equal(questionState.gameId, "fact-or-cap");
    assert.equal(questionState.state.phase, "question");
    assert.equal(questionState.state.currentRound, 1);
    assert.equal(questionState.state.totalRounds, 5);
    assert.equal(typeof questionState.state.prompt.text, "string");
    assert.equal(gameState.state.phase, "answer-submission");
    assert.equal(gameState.state.playerCount, 2);

    const question = questions.find(
        ({ text }) => text === questionState.state.prompt.text
    );
    assert.ok(question);
    assertQuestionPrivateDataAbsent(questionState, question);
    assertQuestionPrivateDataAbsent(gameState, question);

    const firstResponse = await emitWithAck(host, "fake-answer:submit", {
        ...withRoundId(gameState, {
        completion: "A secret underwater library.",
        }),
    });
    assert.deepEqual(firstResponse, {
        submitted: true,
        submissionCount: 1,
        playerCount: 2,
    });
    assert.equal(
        (await emitWithAck(host, "fake-answer:submit", {
            ...withRoundId(gameState, {
            completion: "A second answer from the host.",
            }),
        })).error.code,
        "ALREADY_SUBMITTED"
    );

    const ownCompletions = [
        "A secret underwater library.",
        "A miniature observatory.",
    ];
    const revealEvents = clients.map((client) =>
        waitForGameState(client, (state) => state.state.phase === "reveal")
    );
    const votingEvents = clients.map((client) =>
        waitForGameState(client, (state) => state.state.phase === "voting")
    );
    const secondResponse = await emitWithAck(players[0], "fake-answer:submit", {
        ...withRoundId(gameState, {
        completion: ownCompletions[1],
        }),
    });
    assert.deepEqual(secondResponse, {
        submitted: true,
        submissionCount: 2,
        playerCount: 2,
    });
    const revealStates = await Promise.all(revealEvents);
    for (let index = 0; index < revealStates.length; index += 1) {
        const state = revealStates[index];
        assert.equal(state.state.phase, "reveal");
        assert.equal(state.state.submissionCount, 2);
        assert.equal(state.state.options.length, 3);
        assert.equal(
            state.state.options.find(
                ({ completion }) =>
                    completion === ownCompletions[index]
            ).isOwnAnswer,
            true
        );
        assert.equal(
            state.state.options.some(({ completion }) =>
                completion === question.correctCompletion
            ),
            true
        );
        assert.ok(
            state.state.options.every(
                (option) =>
                    Object.keys(option).sort().join(",") === "completion,id,isOwnAnswer" &&
                    typeof option.isOwnAnswer === "boolean" &&
                    /^[0-9a-f-]{36}$/i.test(option.id)
            )
        );
    }
    assert.deepEqual(
        revealStates[0].state.options.map(({ id }) => id),
        revealStates[1].state.options.map(({ id }) => id)
    );
    assert.notDeepEqual(
        revealStates[0].state.options.map(({ isOwnAnswer }) => isOwnAnswer),
        revealStates[1].state.options.map(({ isOwnAnswer }) => isOwnAnswer)
    );

    const votingStates = await Promise.all(votingEvents);
    for (let index = 0; index < votingStates.length; index += 1) {
        const state = votingStates[index];
        assert.equal(state.state.phase, "voting");
        assert.equal(state.state.voteCount, 0);
        assert.deepEqual(state.state.options, revealStates[index].state.options);
        assert.ok(state.state.options.some(
            ({ completion }) => completion === question.correctCompletion
        ));
        assert.ok(state.state.options.some(
            ({ completion }) => completion === ownCompletions[index]
        ));
    }

    const hostOwnOptionId = votingStates[1].state.options.find(
        ({ completion }) => completion === ownCompletions[0]
    ).id;
    assert.equal(
        (await emitWithAck(host, "fake-answer:vote", withRoundId(votingStates[1], {
            optionId: hostOwnOptionId,
        }))).error.code,
        "OWN_ANSWER_NOT_ALLOWED"
    );
    assert.equal(
        (await emitWithAck(host, "fake-answer:vote", withRoundId(votingStates[1], {
            optionId: "fabricated-option",
        }))).error.code,
        "INVALID_OPTION"
    );
    assert.equal(
        (await emitWithAck(host, "fake-answer:vote", {
            ...withRoundId(votingStates[1], {
            optionId: votingStates[0].state.options[0].id,
            playerId: players[0].id,
            }),
        })).error.code,
        "INVALID_REQUEST"
    );
    assert.equal(
        (await emitWithAck(host, "fake-answer:vote", {
            ...withRoundId(votingStates[1], {
            optionId: votingStates[0].state.options[0].id,
            score: 999,
            }),
        })).error.code,
        "INVALID_REQUEST"
    );
    const outsider = await harness.connect();
    assert.equal(
        (await emitWithAck(outsider, "fake-answer:vote", {
            optionId: "outsider",
            sessionId: votingStates[1].sessionId,
            roundId: votingStates[1].state.roundId,
        })).error.code,
        "NOT_IN_ROOM"
    );

    const hostWaiting = waitForGameState(
        host,
        (state) => state.state.phase === "waiting-for-results"
    );
    const guestWaiting = waitForGameState(
        players[0],
        (state) => state.state.phase === "waiting-for-results"
    );
    const hostResults = waitForGameState(
        host,
        (state) => state.state.phase === "results"
    );
    const guestResults = waitForGameState(
        players[0],
        (state) => state.state.phase === "results"
    );
    const hostVotableOptions = votingStates[0].state.options.filter(
        ({ isOwnAnswer }) => !isOwnAnswer
    );
    const simultaneousVotes = await Promise.all([
        emitWithAck(host, "fake-answer:vote", withRoundId(votingStates[0], {
            optionId: hostVotableOptions[0].id,
        })),
        emitWithAck(host, "fake-answer:vote", withRoundId(votingStates[0], {
            optionId: hostVotableOptions[1].id,
        })),
    ]);
    const hostVote = simultaneousVotes[0];
    assert.deepEqual(hostVote, { voted: true, voteCount: 1, playerCount: 2 });
    assert.equal(simultaneousVotes[1].error.code, "ALREADY_VOTED");
    const guestVoteProgress = await waitForGameState(
        players[0],
        (state) => state.state.phase === "voting" && state.state.voteCount === 1
    );
    assert.equal(guestVoteProgress.state.voteCount, 1);
    assert.deepEqual(
        guestVoteProgress.state.voteProgress.map(({ playerId, voted }) => ({
            playerId,
            voted
        })),
        [
            { playerId: host.id, voted: true },
            { playerId: players[0].id, voted: false }
        ]
    );
    assert.equal(Object.hasOwn(guestVoteProgress.state, "votes"), false);
    const guestVote = await emitWithAck(players[0], "fake-answer:vote", {
        ...withRoundId(votingStates[1], {
        optionId: votingStates[1].state.options.find(
            ({ isOwnAnswer }) => !isOwnAnswer
        ).id,
        }),
    });
    assert.deepEqual(guestVote, { voted: true, voteCount: 2, playerCount: 2 });
    for (const state of await Promise.all([hostWaiting, guestWaiting])) {
        assert.equal(state.state.phase, "waiting-for-results");
        assert.equal(state.state.voteCount, 2);
        assert.deepEqual(
            state.state.voteProgress.map(({ playerId, voted }) => ({
                playerId,
                voted
            })),
            [
                { playerId: host.id, voted: true },
                { playerId: players[0].id, voted: true }
            ]
        );
        assert.equal(Object.hasOwn(state.state, "options"), false);
        assert.equal(Object.hasOwn(state.state, "votes"), false);
        assert.equal(Object.hasOwn(state.state, "correctOptionId"), false);
        assert.equal(state.state.prompt, null);
        assertQuestionPrivateDataAbsent(state, question);
    }
    const resultsStates = await Promise.all([hostResults, guestResults]);
    for (const state of resultsStates) {
        assert.equal(
            state.state.results.correctCompletion,
            question.correctCompletion
        );
        assert.equal(state.state.results.options.length, 3);
        assert.equal(state.state.results.players.length, 2);
        for (const resultPlayer of state.state.results.players) {
            assert.equal(
                resultPlayer.roundPoints,
                resultPlayer.correctVotePoints + resultPlayer.bluffPoints
            );
            const votedOption = state.state.results.options.find(
                ({ id }) => id === resultPlayer.voteOptionId
            );
            assert.ok(votedOption);
            assert.equal(
                votedOption.voters.some(({ playerId }) =>
                    playerId === resultPlayer.playerId
                ),
                true
            );
        }
        assert.equal(
            state.state.results.players.reduce((sum, player) => sum + player.roundPoints, 0),
            state.state.results.players.reduce(
                (sum, player) => sum + (player.voteCorrect ? 2 : 0),
                0
            ) + state.state.results.options.reduce(
                (sum, option) => sum + state.state.results.players.filter(
                    (player) => player.voteOptionId === option.id && option.authorId !== null
                ).length,
                0
            )
        );
        assert.equal(
            state.state.results.standings.length,
            2
        );
    }
    assert.deepEqual(resultsStates[0].state.results, resultsStates[1].state.results);
});

test("Fact-or-Cap honors a selected round count through completion, lobby return, and replay", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 2, roundCount: 7 });
    const clients = [game.host, ...game.players];
    const room = roomManager.getRoom(game.roomCode);
    const initialHostId = room.hostId;
    const initialPlayerIds = room.players.map(({ id }) => id);
    const promptIds = new Set();
    let roundGameState = game.gameState;

    for (let round = 1; round <= roundGameState.state.totalRounds; round += 1) {
        assert.equal(roundGameState.state.currentRound, round);
        assert.equal(roundGameState.status, "active");
        assert.equal(promptIds.has(roundGameState.state.prompt.id), false);
        promptIds.add(roundGameState.state.prompt.id);

        const resultStates = await completeSocketRound(
            game.host,
            game.players,
            roundGameState
        );
        for (const state of resultStates) {
            assert.equal(state.state.phase, "results");
            assert.equal(state.state.currentRound, round);
            assert.deepEqual(state.state.results.standings.map(
                ({ totalScore, rank }) => ({ totalScore, rank })
            ), [
                    { totalScore: round * 2, rank: 1 },
                    { totalScore: round * 2, rank: 1 },
            ]);
            if (round < roundGameState.state.totalRounds) {
                assert.equal(Object.hasOwn(state.state, "finalStatistics"), false);
                assert.deepEqual(
                    state.state.continueProgress.map(
                        ({ playerId, ready }) => ({ playerId, ready })
                    ),
                    [
                        { playerId: game.host.id, ready: false },
                        { playerId: game.players[0].id, ready: false }
                    ]
                );
            }
        }

        if (round < roundGameState.state.totalRounds) {
            const previousRoundId = roundGameState.state.roundId;
            const previousSessionId = roundGameState.sessionId;
            const previousPromptId = roundGameState.state.prompt.id;
            const previousOptionId = resultStates[0].state.results.options[0].id;
            const guestProgress = waitForGameState(
                game.players[0],
                (state) =>
                    state.state.phase === "results" &&
                    state.state.continueReadyCount === 1
            );
            const duplicateContinueResponses = await Promise.all([
                emitWithAck(game.host, "fake-answer:continue", {
                    sessionId: previousSessionId,
                    roundId: previousRoundId,
                }),
                emitWithAck(game.host, "fake-answer:continue", {
                    sessionId: previousSessionId,
                    roundId: previousRoundId,
                }),
            ]);
            assert.deepEqual(duplicateContinueResponses[0], {
                ready: true,
                advanced: false,
                readyCount: 1,
                playerCount: 2,
            });
            assert.equal(
                duplicateContinueResponses[1].error.code,
                "ALREADY_READY"
            );
            const guestProgressState = await guestProgress;
            assert.equal(guestProgressState.state.viewerReadyToContinue, false);
            assert.deepEqual(
                guestProgressState.state.continueProgress.map(
                    ({ playerId, ready }) => ({ playerId, ready })
                ),
                [
                    { playerId: game.host.id, ready: true },
                    { playerId: game.players[0].id, ready: false }
                ]
            );

            const nextQuestionStates = clients.map((client) =>
                waitForGameState(
                    client,
                    (state) =>
                        state.state.phase === "question" &&
                        state.state.currentRound === round + 1
                )
            );
            assert.deepEqual(
                await emitWithAck(game.players[0], "fake-answer:continue", {
                    sessionId: previousSessionId,
                    roundId: previousRoundId,
                }),
                {
                    ready: true,
                    advanced: true,
                    readyCount: 0,
                    playerCount: 2,
                }
            );
            const nextQuestionStatesReceived = await Promise.all(nextQuestionStates);
            const nextQuestionState = nextQuestionStatesReceived[0];
            assert.equal(nextQuestionState.status, "active");
            assert.notEqual(nextQuestionState.state.roundId, previousRoundId);
            assert.equal(nextQuestionState.state.submissionCount, 0);
            assert.equal(Object.hasOwn(nextQuestionState.state, "options"), false);
            assert.notEqual(nextQuestionState.state.prompt.id, previousPromptId);

            assert.equal(
                (await emitWithAck(game.host, "fake-answer:submit", {
                    completion: "Delayed answer from the previous round",
                    sessionId: previousSessionId,
                    roundId: previousRoundId,
                })).error.code,
                "ROUND_MISMATCH"
            );
            assert.equal(
                (await emitWithAck(game.host, "fake-answer:vote", {
                    optionId: previousOptionId,
                    sessionId: previousSessionId,
                    roundId: previousRoundId,
                })).error.code,
                "ROUND_MISMATCH"
            );
            assert.equal(
                (await emitWithAck(game.host, "fake-answer:continue", {
                    sessionId: previousSessionId,
                    roundId: previousRoundId,
                })).error.code,
                "ROUND_MISMATCH"
            );
            const nextSubmissionStates = clients.map((client) =>
                waitForGameState(
                    client,
                    (state) =>
                        state.state.phase === "answer-submission" &&
                        state.state.currentRound === round + 1
                )
            );
            roundGameState = (await Promise.all(nextSubmissionStates))[0];
        } else {
            assert.equal(resultStates[0].status, "finished");
            assert.equal(resultStates[1].status, "finished");
            assert.equal(resultStates[0].state.isFinalRound, true);
            assert.deepEqual(resultStates[0].state.finalStatistics, {
                mostPlayersFooled: { playerIds: [], count: 0 },
                gotFooledMost: { playerIds: [], count: 0 },
                mostCorrectAnswers: {
                    playerIds: [game.host.id, game.players[0].id].sort(),
                    count: round
                }
            });
        }
    }

    assert.equal(promptIds.size, roundGameState.state.totalRounds);
    assert.equal(roomManager.getRoom(game.roomCode), room);
    assert.equal(room.hostId, initialHostId);
    assert.deepEqual(room.players.map(({ id }) => id), initialPlayerIds);
    assert.equal(room.selectedGameId, "fact-or-cap");
    assert.equal(room.players.length, 2);
    for (const client of clients) {
        assert.equal(client.connected, true);
    }

    const finalRoundId = roundGameState.state.roundId;
    const finalSessionId = roundGameState.sessionId;
    assert.equal(
        (await emitWithAck(game.host, "fake-answer:submit", {
            completion: "No more answers",
            sessionId: finalSessionId,
            roundId: finalRoundId,
        })).error.code,
        "GAME_NOT_ACTIVE"
    );
    assert.equal(
        (await emitWithAck(game.host, "fake-answer:continue", {
            sessionId: finalSessionId,
            roundId: finalRoundId,
        })).error.code,
        "GAME_NOT_ACTIVE"
    );

    const hostLobby = waitForLobby(game.host, (lobby) => lobby.status === "lobby");
    const returnResponses = await Promise.all([
        emitWithAck(game.host, "return-to-lobby", { sessionId: finalSessionId }),
        emitWithAck(game.host, "return-to-lobby", { sessionId: finalSessionId }),
    ]);
    assert.deepEqual(returnResponses[0], { returned: true });
    assert.equal(returnResponses[1].error.code, "ROOM_NOT_IN_GAME");
    const hostLobbyState = await hostLobby;
    assert.equal(hostLobbyState.roomCode, game.roomCode);
    assert.equal(hostLobbyState.status, "lobby");
    assert.equal(hostLobbyState.selectedGameId, "fact-or-cap");
    assert.equal(hostLobbyState.selectedRoundCount, 7);
    assert.equal(hostLobbyState.playerCount, 1);
    assert.equal(hostLobbyState.players.find(({ id }) => id === game.players[0].id).isInGame, true);
    assert.deepEqual(
        hostLobbyState.players.map(({ id, isHost, isReady }) => ({
            id,
            isHost,
            isReady,
        })),
        initialPlayerIds.map((id, index) => ({
            id,
            isHost: index === 0,
            isReady: false,
        }))
    );
    assert.equal(roomManager.getRoom(game.roomCode), room);
    assert.equal(room.hostId, initialHostId);
    assert.equal(room.players.length, 2);
    assert.throws(
        () => gameManager.getPublicGameState(game.roomCode, game.host.id),
        { code: "GAME_NOT_ACTIVE" }
    );
    assert.equal((await emitWithAck(game.players[0], "set-ready", { isReady: true })).error.code, "PLAYER_VIEWING_RESULTS");
    assert.equal((await emitWithAck(game.host, "start-game")).error.code, "NOT_ENOUGH_PLAYERS");

    const returnedGuestLobby = waitForLobby(game.players[0], (lobby) => lobby.status === "lobby");
    assert.deepEqual(await emitWithAck(game.players[0], "return-from-results", { sessionId: finalSessionId }), {
        returned: true,
        status: "lobby"
    });
    const guestLobbyState = await returnedGuestLobby;
    assert.equal(guestLobbyState.playerCount, 2);
    assert.equal(guestLobbyState.players.find(({ id }) => id === game.players[0].id).isInGame, false);

    const readyLobby = waitForLobby(game.host, (lobby) =>
        lobby.players.every((player) => player.isReady || player.isHost)
    );
    await emitWithAck(game.players[0], "set-ready", { isReady: true });
    await readyLobby;
    const replayHostState = waitForGameState(
        game.host,
        (state) => state.state.phase === "question"
    );
    const replayGuestState = waitForGameState(
        game.players[0],
        (state) => state.state.phase === "question"
    );
    const startResponse = await emitWithAck(game.host, "start-game");
    assert.equal(startResponse.starting, true);
    assert.equal(startResponse.game.state.phase, "question");
    const [replayHost, replayGuest] = await Promise.all([
        replayHostState,
        replayGuestState,
    ]);
    assert.deepEqual(replayHost, replayGuest);
    assert.equal(replayHost.roomCode, game.roomCode);
    assert.equal(replayHost.status, "active");
    assert.equal(replayHost.gameId, room.selectedGameId);
    assert.notEqual(replayHost.sessionId, roundGameState.sessionId);
    assert.equal(replayHost.state.phase, "question");
    assert.equal(replayHost.state.currentRound, 1);
    assert.equal(replayHost.state.totalRounds, 7);
    assert.equal(replayHost.state.submissionCount, 0);
    assert.equal(Object.hasOwn(replayHost.state, "options"), false);
    assert.equal(Object.hasOwn(replayHost.state, "votes"), false);
    assert.equal(Object.hasOwn(replayHost.state, "results"), false);
    assert.equal(Object.hasOwn(replayHost.state, "scores"), false);
    assert.equal(roomManager.getRoom(game.roomCode), room);
    assert.equal(room.hostId, initialHostId);
    assert.equal(room.players.length, 2);

    assert.equal(
        (await emitWithAck(game.host, "fake-answer:submit", {
            completion: "Stale answer from the previous session",
            sessionId: finalSessionId,
            roundId: finalRoundId,
        })).error.code,
        "SESSION_MISMATCH"
    );
    assert.equal(
        (await emitWithAck(game.host, "fake-answer:vote", {
            optionId: "stale-option",
            sessionId: finalSessionId,
            roundId: finalRoundId,
        })).error.code,
        "SESSION_MISMATCH"
    );
    assert.equal(
        (await emitWithAck(game.host, "fake-answer:continue", {
            sessionId: finalSessionId,
            roundId: finalRoundId,
        })).error.code,
        "SESSION_MISMATCH"
    );
    assert.equal(
        (await emitWithAck(game.players[0], "return-to-lobby", {
            sessionId: replayGuest.sessionId,
        })).error.code,
        "NOT_HOST"
    );
});

test("return-to-lobby is host-only and requires a finished game", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 2 });

    assert.equal(
        (await emitWithAck(game.players[0], "return-to-lobby", {
            sessionId: game.gameState.sessionId,
        })).error.code,
        "NOT_HOST"
    );
    assert.equal(
        (await emitWithAck(game.host, "return-to-lobby", {
            sessionId: game.gameState.sessionId,
        })).error.code,
        "GAME_NOT_FINISHED"
    );
    const room = roomManager.getRoom(game.roomCode);
    assert.equal(room.status, "starting");
    assert.deepEqual(
        room.players.map(({ isReady }) => isReady),
        [false, true]
    );
    assert.equal(gameManager.getPublicGameState(game.roomCode, game.host.id).status, "active");
});

test("a transferred host viewing finished results returns from results instead of repeating the room transition", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 3 });
    const clients = [game.host, ...game.players];
    let gameState = game.gameState;

    for (let round = 1; round <= gameState.state.totalRounds; round += 1) {
        const results = await completeSocketRound(game.host, game.players, gameState);
        assert.equal(results[0].state.currentRound, round);
        if (round < gameState.state.totalRounds) {
            const nextSubmissionStates = clients.map((client) =>
                waitForGameState(client, (state) =>
                    state.state.phase === "answer-submission" &&
                    state.state.currentRound === round + 1
                )
            );
            for (const client of clients) {
                const response = await emitWithAck(client, "fake-answer:continue", {
                    sessionId: gameState.sessionId,
                    roundId: gameState.state.roundId
                });
                assert.equal(response.error, undefined);
            }
            gameState = (await Promise.all(nextSubmissionStates))[0];
        }
    }

    const finishedSessionId = gameState.sessionId;
    assert.equal(roomManager.getRoom(game.roomCode).status, "starting");
    const blockedDuringGame = await emitWithAck(game.host, "transfer-host", {
        targetPlayerId: game.players[0].id
    });
    assert.equal(blockedDuringGame.error.code, "ROOM_NOT_IN_LOBBY");

    const hostLobby = waitForLobby(game.host, (lobby) => lobby.status === "lobby");
    const guestResultsLobby = waitForLobby(game.players[0], (lobby) =>
        lobby.status === "lobby" &&
        lobby.players.find(({ id }) => id === game.players[0].id)?.isInGame === true
    );
    const remainingResultsLobby = waitForLobby(game.players[1], (lobby) =>
        lobby.status === "lobby" &&
        lobby.players.find(({ id }) => id === game.players[1].id)?.isInGame === true
    );
    assert.deepEqual(await emitWithAck(game.host, "return-to-lobby", {
        sessionId: finishedSessionId
    }), { returned: true });
    const [hostLobbyState, guestResultsState, remainingResultsState] = await Promise.all([
        hostLobby,
        guestResultsLobby,
        remainingResultsLobby
    ]);
    assert.equal(hostLobbyState.players.find(({ id }) => id === game.host.id).isHost, true);
    assert.equal(guestResultsState.players.find(({ id }) => id === game.players[0].id).isInGame, true);
    assert.equal(remainingResultsState.players.find(({ id }) => id === game.players[1].id).isInGame, true);

    const newHostLobby = waitForLobby(game.players[0], (lobby) =>
        lobby.players.find(({ id }) => id === game.players[0].id)?.isHost === true
    );
    const formerHostLobby = waitForLobby(game.host, (lobby) =>
        lobby.players.find(({ id }) => id === game.players[0].id)?.isHost === true
    );
    const otherPlayerLobby = waitForLobby(game.players[1], (lobby) =>
        lobby.players.find(({ id }) => id === game.players[0].id)?.isHost === true
    );
    assert.equal((await emitWithAck(game.host, "transfer-host", {
        targetPlayerId: game.players[0].id
    })).transferred, true);
    const [newHostState, formerHostState, otherPlayerState] = await Promise.all([
        newHostLobby,
        formerHostLobby,
        otherPlayerLobby
    ]);
    assert.equal(newHostState.players.find(({ id }) => id === game.players[0].id).isHost, true);
    assert.equal(newHostState.players.find(({ id }) => id === game.players[0].id).isInGame, true);
    assert.equal(formerHostState.players.find(({ id }) => id === game.host.id).isHost, false);
    assert.equal(otherPlayerState.players.find(({ id }) => id === game.players[0].id).isHost, true);
    assert.equal(roomManager.getRoom(game.roomCode).hostId, game.players[0].id);

    const staleHostAction = await emitWithAck(game.players[0], "return-to-lobby", {
        sessionId: finishedSessionId
    });
    assert.deepEqual(staleHostAction.error, {
        code: "ROOM_NOT_IN_GAME",
        message: "The room is not in a game."
    });
    assert.equal((await emitWithAck(game.host, "return-to-lobby", {
        sessionId: finishedSessionId
    })).error.code, "NOT_HOST");
    assert.equal((await emitWithAck(game.players[1], "return-to-lobby", {
        sessionId: finishedSessionId
    })).error.code, "NOT_HOST");
    const roomAfterRejectedAction = roomManager.getRoom(game.roomCode);
    assert.equal(roomAfterRejectedAction.status, "lobby");
    assert.equal(roomAfterRejectedAction.hostId, game.players[0].id);
    assert.equal(roomAfterRejectedAction.players.find(
        ({ id }) => id === game.players[0].id
    ).viewingResultsSessionId, finishedSessionId);
    assert.equal(roomAfterRejectedAction.players.find(
        ({ id }) => id === game.players[1].id
    ).viewingResultsSessionId, finishedSessionId);
    assert.throws(
        () => gameManager.getPublicGameState(game.roomCode, game.players[0].id),
        { code: "GAME_NOT_ACTIVE" }
    );

    const newHostReturned = waitForLobby(game.players[0], (lobby) =>
        lobby.players.find(({ id }) => id === game.players[0].id)?.isInGame === false
    );
    const formerHostSeesReturnedNewHost = waitForLobby(game.host, (lobby) =>
        lobby.players.find(({ id }) => id === game.players[0].id)?.isInGame === false
    );
    assert.deepEqual(await emitWithAck(game.players[0], "return-from-results", {
        sessionId: finishedSessionId
    }), { returned: true, status: "lobby" });
    const [newHostLobbyAfterReturn, formerHostLobbyAfterReturn] = await Promise.all([
        newHostReturned,
        formerHostSeesReturnedNewHost
    ]);
    assert.deepEqual(newHostLobbyAfterReturn, formerHostLobbyAfterReturn);
    assert.equal(newHostLobbyAfterReturn.status, "lobby");
    assert.equal(newHostLobbyAfterReturn.players.find(
        ({ id }) => id === game.players[0].id
    ).isHost, true);
    assert.equal(newHostLobbyAfterReturn.players.find(
        ({ id }) => id === game.players[0].id
    ).isInGame, false);
    assert.equal(newHostLobbyAfterReturn.players.find(
        ({ id }) => id === game.host.id
    ).isHost, false);
    assert.equal(roomManager.getRoom(game.roomCode).players.find(
        ({ id }) => id === game.players[0].id
    ).viewingResultsSessionId, null);
    assert.equal(roomManager.getRoom(game.roomCode).players.find(
        ({ id }) => id === game.players[1].id
    ).viewingResultsSessionId, finishedSessionId);
    assert.equal((await emitWithAck(game.players[0], "return-from-results", {
        sessionId: finishedSessionId
    })).error.code, "STALE_RESULTS_SESSION");
});

test("Fact-or-Cap rejects empty, long, duplicate, malformed, and impersonated submissions", async (context) => {
    const harness = await createHarness(context);
    const { host, players, gameState } = await startFakeAnswer(harness);
    const question = questions.find(
        (entry) => entry.text === gameState.state.prompt.text
    );
    assert.ok(question);

    for (const completion of ["   ", "x".repeat(161)]) {
        const response = await emitWithAck(players[0], "fake-answer:submit", withRoundId(gameState, {
            completion,
        }));
        assert.equal(response.error.code, "INVALID_COMPLETION");
    }

    const correctResponse = await emitWithAck(players[0], "fake-answer:submit", withRoundId(gameState, {
        completion: `  ${question.correctCompletion.toUpperCase()}  `,
    }));
    assert.deepEqual(correctResponse.error, {
        code: "DUPLICATE_ANSWER",
        message: "Duplicate answer. Please submit a different completion."
    });
    assert.equal(
        correctResponse.error.message.includes(question.correctCompletion),
        false
    );
    const currentGame = gameManager.getPublicGameState(gameState.roomCode, players[0].id);
    assert.equal(currentGame.state.submissionCount, 0);
    assert.equal(currentGame.state.phase, "answer-submission");

    const impersonation = await emitWithAck(players[0], "fake-answer:submit", withRoundId(gameState, {
        completion: "I am borrowing another player's identity",
        playerId: players[1].id,
    }));
    assert.equal(impersonation.error.code, "INVALID_REQUEST");
    const clientCorrectAnswer = await emitWithAck(players[0], "fake-answer:submit", withRoundId(gameState, {
        completion: "A made up completion",
        correctCompletion: question.correctCompletion,
    }));
    assert.equal(clientCorrectAnswer.error.code, "INVALID_REQUEST");

    for (const payload of [null, [], "malformed", {}, { completion: 1 }]) {
        const response = await emitWithAck(host, "fake-answer:submit", payload);
        assert.equal(response.error.code, "INVALID_REQUEST");
    }

    const simultaneousSubmissions = await Promise.all([
        emitWithAck(players[0], "fake-answer:submit", withRoundId(gameState, {
            completion: "  A believable invented detail.  ",
        })),
        emitWithAck(players[0], "fake-answer:submit", withRoundId(gameState, {
            completion: "A different answer",
        })),
    ]);
    assert.equal(simultaneousSubmissions[0].submitted, true);
    assert.equal(
        simultaneousSubmissions[1].error.code,
        "ALREADY_SUBMITTED"
    );

    const outsider = await harness.connect();
    const outsideRoom = await emitWithAck(outsider, "fake-answer:submit", withRoundId(gameState, {
        completion: "Not a participant",
    }));
    assert.equal(outsideRoom.error.code, "NOT_IN_ROOM");
});

test("malformed ready/start/leave payloads return structured errors", async (context) => {
    const harness = await createHarness(context);
    const client = await harness.connect();
    const created = await emitWithAck(client, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);

    assert.equal((await emitWithAck(client, "set-ready", {})).error.code, "INVALID_REQUEST");
    assert.equal((await emitWithAck(client, "start-game", {})).error.code, "INVALID_REQUEST");
    assert.equal((await emitWithAck(client, "leave-room", {})).error.code, "INVALID_REQUEST");
    assert.equal((await emitWithAck(client, "set-ready", null)).error.code, "INVALID_REQUEST");
    assert.equal(roomManager.getRoom(created.roomCode).players.length, 1);
});

test("same-tab recovery restores the authoritative lobby without duplicating a seat or changing host/settings", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
        visibility: "public",
    });
    harness.trackRoom(created.roomCode);
    const [guest] = await joinPlayers(harness, created.roomCode, 1);
    const selected = await emitWithAck(host, "select-game", {
        gameId: "fact-or-cap-anime",
    });
    const rounds = await emitWithAck(host, "select-round-count", {
        roundCount: 7,
        revision: selected.lobby.revision,
    });
    await emitWithAck(guest, "set-ready", { isReady: true });
    await emitWithAck(host, "transfer-host", { targetPlayerId: guest.playerId });

    const recovered = await disconnectAndRecover(harness, host);
    const restored = await emitWithAck(recovered, "restore-session");
    assert.equal(restored.status, "restored");
    assert.equal(restored.playerId, host.playerId);
    assert.equal(restored.snapshot.playerId, host.playerId);
    assert.equal(restored.snapshot.lobby.roomCode, created.roomCode);
    assert.equal(restored.snapshot.lobby.revision, roomManager.getRoom(created.roomCode).revision);
    assert.equal(restored.snapshot.lobby.status, "lobby");
    assert.equal(restored.snapshot.lobby.visibility, "public");
    assert.equal(restored.snapshot.lobby.selectedGameId, "fact-or-cap-anime");
    assert.equal(restored.snapshot.lobby.selectedRoundCount, 7);
    assert.equal(restored.snapshot.lobby.players.length, 2);
    assert.equal(roomManager.getPlayerRoom(host.playerId).players.length, 2);
    assert.equal(restored.snapshot.lobby.players.find(({ id }) => id === host.playerId).isHost, false);
    assert.equal(restored.snapshot.lobby.players.find(({ id }) => id === guest.playerId).isHost, true);
    assert.equal(restored.snapshot.lobby.players.find(({ id }) => id === guest.playerId).isReady, true);
    assert.equal(
        Object.hasOwn(restored.snapshot.lobby.players.find(({ id }) => id === host.playerId), "connected"),
        false,
    );
    assert.equal(harness.io.disconnectGraceManager.size, 0);

    const { keys } = collectPublicKeysAndStringValues(restored);
    const privateKeys = keys.map((key) => key.toLowerCase());
    assert.equal(privateKeys.some((key) =>
        ["recoverycredential", "credentialhash", "pendingcredentialhash", "accountid", "accesstoken"].includes(key)
    ), false);
    const forged = await emitWithAck(recovered, "restore-session", {
        playerId: guest.playerId,
        roomCode: "FAKE",
    });
    assert.equal(forged.error.code, "INVALID_REQUEST");
    assert.equal(roomManager.getPlayerRoom(host.playerId).players.length, 2);

    await harness.advanceGrace();
    assert.equal(roomManager.getPlayerRoom(host.playerId).code, created.roomCode);
});

test("restoration snapshots include lobby changes broadcast while room joining is pending", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest",
    });
    const hostServerSocket = harness.io.sockets.sockets.get(host.transportId);
    const disconnected = new Promise((resolve) => hostServerSocket.once("disconnect", resolve));
    host.disconnect();
    await disconnected;
    const recovered = await harness.connect({ storage: host.recoveryStorage });
    const recoveredServerSocket = harness.io.sockets.sockets.get(recovered.transportId);
    const originalJoin = recoveredServerSocket.join.bind(recoveredServerSocket);
    let beginJoin;
    const joining = new Promise((resolve) => {
        beginJoin = resolve;
    });
    let releaseJoin;
    const joinGate = new Promise((resolve) => {
        releaseJoin = resolve;
    });
    recoveredServerSocket.join = async (roomCode) => {
        if (roomCode === created.roomCode) {
            beginJoin();
            await joinGate;
        }
        return originalJoin(roomCode);
    };

    const liveUpdate = waitForLobby(recovered, (lobby) =>
        lobby.players.some(({ id, isReady }) => id === guest.playerId && isReady)
    );
    const restoreRequest = emitWithAck(recovered, "restore-session");
    await joining;
    assert.deepEqual(await emitWithAck(guest, "set-ready", { isReady: true }), { isReady: true });
    const receivedLiveUpdate = await liveUpdate;
    assert.equal(receivedLiveUpdate.players.find(({ id }) => id === guest.playerId).isReady, true);
    releaseJoin();
    const restored = await restoreRequest;
    recoveredServerSocket.join = originalJoin;

    assert.equal(restored.status, "restored");
    assert.equal(restored.snapshot.lobby.revision, roomManager.getRoom(created.roomCode).revision);
    assert.equal(restored.snapshot.lobby.players.find(({ id }) => id === guest.playerId).isReady, true);
    assert.equal(roomManager.getPlayerRoom(host.playerId).players.length, 2);
});

test("active game restoration preserves the current round and only returns the viewer's permitted state", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, {
        playerCount: 3,
        waitForSubmission: true,
    });
    const [guest] = game.players;
    const privateAnswer = "A submission that only the author may see before reveal";
    const submitted = await emitWithAck(
        guest,
        "fake-answer:submit",
        withRoundId(game.gameState, { completion: privateAnswer }),
    );
    assert.equal(submitted.submitted, true);
    const beforeRecovery = gameManager.getPublicGameState(game.roomCode, game.host.playerId);
    const recovered = await disconnectAndRecover(harness, game.host);
    const [first, repeated] = await Promise.all([
        emitWithAck(recovered, "restore-session"),
        emitWithAck(recovered, "restore-session"),
    ]);

    assert.equal(first.status, "restored");
    assert.deepEqual(repeated, first);
    assert.equal(first.snapshot.lobby.status, "starting");
    assert.equal(first.snapshot.lobby.players.length, 3);
    assert.equal(first.snapshot.lobby.players.find(({ id }) => id === game.host.playerId).isHost, true);
    assert.equal(first.snapshot.game.sessionId, beforeRecovery.sessionId);
    assert.equal(first.snapshot.game.state.roundId, beforeRecovery.state.roundId);
    assert.equal(first.snapshot.game.state.phase, "answer-submission");
    assert.equal(first.snapshot.game.state.viewerIsSpectator, true);
    assert.equal(
        first.snapshot.game.state.submissionProgress.find(({ playerId }) => playerId === guest.playerId).submitted,
        true,
    );
    assert.equal(Object.hasOwn(first.snapshot.game.state, "viewerSubmission"), false);
    assert.equal(
        collectPublicKeysAndStringValues(first.snapshot.game).stringValues.includes(privateAnswer),
        false,
    );
    const current = gameManager.getPublicGameState(game.roomCode, game.host.playerId);
    assert.equal(current.sessionId, beforeRecovery.sessionId);
    assert.equal(current.state.roundId, beforeRecovery.state.roundId);
    assert.equal(current.state.phase, "answer-submission");
    assert.equal(current.revision, first.snapshot.game.revision);
    assert.equal(roomManager.getRoom(game.roomCode).players.length, 3);
});

test("Fact-or-Cap restoration preserves a viewer's own submission and vote in voting", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 2 });
    const clients = [game.host, ...game.players];
    const ownCompletion = "Only the submitting guest knows this here.";
    for (const [index, client] of clients.entries()) {
        const response = await emitWithAck(
            client,
            "fake-answer:submit",
            withRoundId(game.gameState, {
                completion: index === 0 ? ownCompletion : "The other player's completion.",
            }),
        );
        assert.equal(response.error, undefined);
    }

    const voting = gameManager.getPublicGameState(game.roomCode, game.host.playerId);
    assert.equal(voting.state.phase, "voting");
    const selectedOption = voting.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
    assert.ok(selectedOption);
    assert.equal((await emitWithAck(
        game.host,
        "fake-answer:vote",
        withRoundId(voting, { optionId: selectedOption.id }),
    )).voted, true);

    const recovered = await disconnectAndRecover(harness, game.host);
    const restored = await emitWithAck(recovered, "restore-session");
    const state = restored.snapshot.game.state;
    assert.equal(state.phase, "voting");
    assert.equal(state.viewerSubmission, ownCompletion);
    assert.equal(state.viewerVoteOptionId, selectedOption.id);
    assert.equal(state.voteProgress.find(({ playerId }) => playerId === recovered.playerId).voted, true);
    assert.equal(state.voteProgress.find(({ playerId }) => playerId === game.players[0].playerId).voted, false);
    assert.equal(Object.hasOwn(state, "votes"), false);
    assert.equal(state.options.some((option) => Object.hasOwn(option, "authorId")), false);
});

test("Bruh WTF restoration preserves the viewer's own answer and vote without exposing answer authors", async (context) => {
    const harness = await createHarness(context);
    const [host, guest, third] = await Promise.all([
        harness.connect(),
        harness.connect(),
        harness.connect(),
    ]);
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.trackRoom(created.roomCode);
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    await emitWithAck(third, "join-room", { roomCode: created.roomCode, playerName: "Third" });
    const selection = await emitWithAck(host, "select-game", { gameId: "bruh-wtf" });
    assert.equal(selection.error, undefined);
    await emitWithAck(guest, "set-ready", { isReady: true });
    await emitWithAck(third, "set-ready", { isReady: true });
    const initialState = waitForGameState(host, (gameState) =>
        gameState.gameId === "bruh-wtf" && gameState.state.phase === "answer-submission"
    );
    const started = await emitWithAck(host, "start-game");
    assert.equal(started.error, undefined);
    const initial = await initialState;
    assert.equal(initial.sessionId, started.game.sessionId);
    const ownAnswer = "Host's private answer before voting.";
    for (const [client, answer] of [
        [host, ownAnswer],
        [guest, "Guest answer."],
        [third, "Third answer."],
    ]) {
        assert.equal((await emitWithAck(client, "bruh-wtf:submit", {
            sessionId: initial.sessionId,
            roundId: initial.state.roundId,
            answer,
        })).error, undefined);
    }

    const voting = gameManager.getPublicGameState(created.roomCode, host.playerId);
    assert.equal(voting.state.phase, "voting");
    const selectedOption = voting.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
    assert.ok(selectedOption);
    assert.equal((await emitWithAck(host, "bruh-wtf:vote", {
        sessionId: voting.sessionId,
        roundId: voting.state.roundId,
        optionId: selectedOption.id,
    })).voted, true);

    const recovered = await disconnectAndRecover(harness, host);
    const restored = await emitWithAck(recovered, "restore-session");
    const state = restored.snapshot.game.state;
    assert.equal(state.phase, "voting");
    assert.equal(state.viewerSubmission, ownAnswer);
    assert.equal(state.viewerVoteOptionId, selectedOption.id);
    assert.equal(state.voteProgress.find(({ playerId }) => playerId === recovered.playerId).voted, true);
    assert.equal(Object.hasOwn(state, "votes"), false);
    assert.equal(state.options.some((option) => Object.hasOwn(option, "authorId")), false);
    assert.equal(restored.snapshot.game.sessionId, initial.sessionId);
});

test("results viewers restore their finished result screen; expiry yields no room but keeps the guest identity reusable", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, {
        playerCount: 2,
        waitForSubmission: false,
    });
    const playerIds = [game.host.playerId, game.players[0].playerId];
    const finalState = finishManagedFactOrCapGame(game.roomCode, playerIds);
    assert.equal(finalState.status, "finished");
    assert.equal(finalState.state.phase, "results");
    assert.deepEqual(await emitWithAck(game.host, "return-to-lobby", {
        sessionId: finalState.sessionId,
    }), { returned: true });

    const resultsViewer = await disconnectAndRecover(harness, game.players[0]);
    const resultsSnapshot = await emitWithAck(resultsViewer, "restore-session");
    assert.equal(resultsSnapshot.status, "restored");
    assert.equal(resultsSnapshot.snapshot.lobby.status, "lobby");
    assert.equal(
        resultsSnapshot.snapshot.lobby.players.find(({ id }) => id === resultsViewer.playerId).isInGame,
        true,
    );
    assert.equal(resultsSnapshot.snapshot.game.status, "finished");
    assert.equal(resultsSnapshot.snapshot.game.sessionId, finalState.sessionId);
    assert.equal(resultsSnapshot.snapshot.game.state.phase, "results");
    assert.equal(resultsSnapshot.snapshot.game.state.results.players.length, 2);
    assert.equal(roomManager.getRoom(game.roomCode).players.length, 2);

    const expiring = await harness.connect();
    const created = await emitWithAck(expiring, "create-room", { playerName: "Leaving" });
    harness.trackRoom(created.roomCode);
    const recoveryStorage = expiring.recoveryStorage;
    const expiredPlayerId = expiring.playerId;
    expiring.disconnect();
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (harness.io.disconnectGraceManager.entries.has(expiredPlayerId)) break;
        await new Promise((resolve) => setImmediate(resolve));
    }
    await harness.advanceGrace();
    assert.equal(roomManager.getPlayerRoom(expiredPlayerId), null);
    const recovered = await harness.connect({ storage: recoveryStorage });
    const noRoom = await emitWithAck(recovered, "restore-session");
    assert.deepEqual(noRoom, { status: "no-room", playerId: expiredPlayerId });
    assert.equal(recovered.playerId, expiredPlayerId);

    const otherHost = await harness.connect();
    const otherRoom = await emitWithAck(otherHost, "create-room", { playerName: "Other host" });
    harness.trackRoom(otherRoom.roomCode);
    const joined = await emitWithAck(recovered, "join-room", {
        roomCode: otherRoom.roomCode,
        playerName: "Returning guest",
    });
    assert.equal(joined.error, undefined);
    assert.equal(joined.lobby.players.some(({ id }) => id === expiredPlayerId), true);
    assert.deepEqual(await emitWithAck(recovered, "leave-room"), { left: true });
    assert.deepEqual(
        await emitWithAck(recovered, "restore-session"),
        { status: "no-room", playerId: expiredPlayerId },
    );
    assert.equal(recovered.playerId, expiredPlayerId);
});
