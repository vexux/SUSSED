const assert = require("node:assert/strict");
const test = require("node:test");
const { io: createClient } = require("socket.io-client");
const { port: defaultPort } = require("../config");
const gameManager = require("../gameManager");
const { questions } = require("../games/fake-answer/questionBank");
const roomManager = require("../roomManager");
const { startServer } = require("../server");

async function createHarness(context) {
    const io = startServer(0);
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
        async connect() {
            const client = createClient(`http://127.0.0.1:${address.port}`, {
                reconnection: false,
                timeout: 3000,
            });
            clients.push(client);
            await new Promise((resolve, reject) => {
                client.once("connect", resolve);
                client.once("connect_error", reject);
            });
            return client;
        },
        trackRoom(roomCode) {
            roomCodes.add(roomCode);
        },
    };
}

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

async function startFakeAnswer(
    harness,
    { playerCount = 4, waitForSubmission = true } = {}
) {
    const host = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    const players = await joinPlayers(harness, created.roomCode, playerCount - 1);
    for (const player of players) {
        await emitWithAck(player, "set-ready", { isReady: true });
    }

    const initialState = waitForGameState(host, (game) => game.state.phase === "question");
    assert.deepEqual(await emitWithAck(host, "start-game"), { starting: true });
    const questionState = await initialState;
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

    assert.match(response.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
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

    const serverSocket = harness.io.sockets.sockets.get(client.id);
    assert.ok(serverSocket.rooms.has(response.roomCode));
});

test("joins an existing room, normalizes its code, and sends lobby state to both players", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const hostLobbyEvent = waitForLobby(host);
    const createResponse = await emitWithAck(host, "create-room", {
        playerName: "  Host Name ",
    });
    assert.match(createResponse.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
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
    assert.equal(response.lobby.selectedGameId, "fake-answer");
    assert.deepEqual(response.lobby.selectedGame, {
        id: "fake-answer",
        displayName: "Fake Answer",
        minPlayers: 2,
        maxPlayers: 8
    });
    assert.deepEqual(response.lobby.availableGames, [response.lobby.selectedGame]);
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
        "playerCount",
        "players",
        "roomCode",
        "selectedGame",
        "selectedGameId",
        "status",
    ]);
    assert.deepEqual(Object.keys(response.lobby.players[0]).sort(), [
        "id",
        "isHost",
        "isReady",
        "name",
    ]);

    const serverSocket = harness.io.sockets.sockets.get(guest.id);
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

    const hostUpdate = waitForLobby(
        host,
        (lobby) => lobby.selectedGameId === "fake-answer" && !lobby.players[1].isReady
    );
    const guestUpdate = waitForLobby(
        guest,
        (lobby) => lobby.selectedGameId === "fake-answer" && !lobby.players[1].isReady
    );
    assert.deepEqual(
        await emitWithAck(host, "select-game", { gameId: "fake-answer" }),
        { selectedGameId: "fake-answer" }
    );
    const [hostLobby, guestLobby] = await Promise.all([hostUpdate, guestUpdate]);
    assert.deepEqual(hostLobby, guestLobby);
    assert.equal(hostLobby.players[1].isReady, false);
    assert.equal(hostLobby.selectedGame.displayName, "Fake Answer");
    assert.deepEqual(hostLobby.availableGames.map(({ id }) => id), ["fake-answer"]);
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
        (await emitWithAck(guest, "select-game", { gameId: "fake-answer" })).error.code,
        "NOT_HOST"
    );
    assert.equal(
        (await emitWithAck(host, "select-game", { gameId: "not-registered" })).error.code,
        "GAME_NOT_FOUND"
    );
    assert.equal(
        (await emitWithAck(host, "select-game", { gameId: "fake-answer", displayName: "Injected" })).error.code,
        "INVALID_REQUEST"
    );
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

test("rejects joins when the room is full", async (context) => {
    const harness = await createHarness(context);
    const players = [];
    for (let index = 0; index < roomManager.MAX_PLAYERS + 1; index += 1) {
        players.push(await harness.connect());
    }

    const createResponse = await emitWithAck(players[0], "create-room", {
        playerName: "Player 0",
    });
    harness.trackRoom(createResponse.roomCode);

    for (let index = 1; index < roomManager.MAX_PLAYERS; index += 1) {
        const response = await emitWithAck(players[index], "join-room", {
            roomCode: createResponse.roomCode,
            playerName: `Player ${index}`,
        });
        assert.equal(response.lobby.playerCount, index + 1);
    }

    const response = await emitWithAck(players[roomManager.MAX_PLAYERS], "join-room", {
        roomCode: createResponse.roomCode,
        playerName: "One too many",
    });
    assert.equal(response.error.code, "ROOM_FULL");
    assert.equal(roomManager.getRoom(createResponse.roomCode).players.length, 8);
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
        { id: host.id, name: "Host", isHost: true, isReady: false },
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
    assert.match(validResponse.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    harness.trackRoom(validResponse.roomCode);
});

test("removes a newly created room when the creator socket cannot join it", async (context) => {
    const harness = await createHarness(context);
    const client = await harness.connect();
    const serverSocket = harness.io.sockets.sockets.get(client.id);
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

test("disconnect removes a player and broadcasts the updated lobby", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const createResponse = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(createResponse.roomCode);
    const hostSocket = harness.io.sockets.sockets.get(host.id);
    await emitWithAck(guest, "join-room", {
        roomCode: createResponse.roomCode,
        playerName: "Guest",
    });

    const lobbyUpdate = waitForLobby(host, (lobby) => lobby.playerCount === 1);
    const disconnected = new Promise((resolve) =>
        harness.io.sockets.sockets.get(guest.id).once("disconnect", resolve)
    );
    guest.disconnect();
    await disconnected;
    const lobby = await lobbyUpdate;

    assert.deepEqual(lobby.players, [
        { id: host.id, name: "Host", isHost: true, isReady: false },
    ]);
    assert.equal(roomManager.getPlayerRoom(guest.id), null);
    assert.equal(roomManager.getRoom(createResponse.roomCode).players.length, 1);
    assert.ok(hostSocket.rooms.has(createResponse.roomCode));
});

test("disconnect deletes a room when its last player leaves", async (context) => {
    const harness = await createHarness(context);
    const host = await harness.connect();
    const response = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(response.roomCode);
    const serverSocket = harness.io.sockets.sockets.get(host.id);
    const disconnected = new Promise((resolve) =>
        serverSocket.once("disconnect", resolve)
    );
    host.disconnect();
    await disconnected;

    assert.equal(roomManager.getRoom(response.roomCode), null);
    assert.equal(roomManager.getPlayerRoom(host.id), null);
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
    const hostUpdate = waitForLobby(nextHost, (lobby) => lobby.playerCount === 2);
    const lastPlayerUpdate = waitForLobby(lastPlayer, (lobby) => lobby.playerCount === 2);
    const disconnected = new Promise((resolve) =>
        harness.io.sockets.sockets.get(host.id).once("disconnect", resolve)
    );
    host.disconnect();
    await disconnected;

    const lobby = await hostUpdate;
    assert.deepEqual(await lastPlayerUpdate, lobby);
    assert.equal(lobby.players[0].id, nextHost.id);
    assert.equal(lobby.players[0].isHost, true);
    assert.equal(lobby.players.some((player) => player.isHost), true);
    assert.equal(roomManager.getRoom(created.roomCode).hostId, nextHost.id);
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
    const response = await emitWithAck(host, "start-game");
    assert.deepEqual(response, { starting: true });
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

    assert.deepEqual(await emitWithAck(host, "start-game"), { starting: true });
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
    assert.deepEqual(await emitWithAck(host, "start-game"), { starting: true });
    const receivedFlows = await Promise.all(startFlows);
    const { startingPayload, gameState: hostState } = receivedFlows[0];
    assert.equal(startingPayload.roomCode, created.roomCode);
    assert.equal(startingPayload.lobby.status, "starting");
    assert.equal(startingPayload.lobby.playerCount, 4);
    for (const flow of receivedFlows) {
        assert.deepEqual(flow.events, ["game-starting", "game-state"]);
        assert.deepEqual(flow.startingPayload, startingPayload);
        assert.deepEqual(flow.gameState, hostState);
    }
    assert.equal(hostState.roomCode, created.roomCode);
    assert.equal(hostState.gameId, "fake-answer");
    assert.equal(hostState.displayName, "Fake Answer");
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
    assert.ok(questions.some((question) => question.id === hostState.state.prompt.id));
    assert.deepEqual(Object.keys(hostState).sort(), [
        "displayName",
        "gameId",
        "players",
        "roomCode",
        "state",
        "status",
    ]);
    assert.deepEqual(Object.keys(hostState.state.prompt).sort(), ["id", "text"]);
    const selectedQuestion = questions.find(
        (question) => question.id === hostState.state.prompt.id
    );
    assert.ok(selectedQuestion);
    assert.equal(JSON.stringify(hostState).includes(selectedQuestion.correctCompletion), false);
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
        (await emitWithAck(host, "start-game", { gameId: "fake-answer" })).error.code,
        "INVALID_REQUEST"
    );
    assert.equal((await emitWithAck(host, "start-game", null)).error.code, "INVALID_REQUEST");

    const hostGameState = waitForGameState(host);
    const guestGameState = waitForGameState(guests[0]);
    await emitWithAck(host, "start-game");
    const [hostState, guestState] = await Promise.all([hostGameState, guestGameState]);
    assert.deepEqual(hostState.state, guestState.state);
    assert.equal(hostState.gameId, "fake-answer");
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

    assert.deepEqual(await emitWithAck(host, "start-game"), { starting: true });
    assert.equal(
        (await emitWithAck(host, "select-game", { gameId: "fake-answer" })).error.code,
        "ROOM_NOT_IN_LOBBY"
    );
});

test("fake-answer opens submissions after the question state and rejects early submissions", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { waitForSubmission: false });

    assert.equal(game.questionState.state.phase, "question");
    assert.ok(game.questionState.state.prompt.text);
    const response = await emitWithAck(game.players[0], "fake-answer:submit", {
        completion: "Too early",
    });
    assert.equal(response.error.code, "SUBMISSIONS_NOT_OPEN");
    assert.equal(
        (await emitWithAck(game.players[0], "fake-answer:vote", {
            optionId: "not-an-option",
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

test("fake-answer submissions broadcast safe progress and enter reveal after all players submit", async (context) => {
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
        "submissionCount",
        "totalRounds",
    ]);

    const progressEvents = clients.map((client) =>
        waitForGameState(client, (state) => state.state.submissionCount === 1)
    );
    const firstResponse = await emitWithAck(players[0], "fake-answer:submit", {
        completion: submittedCompletions[1],
    });
    assert.deepEqual(firstResponse, {
        submitted: true,
        submissionCount: 1,
        playerCount: clients.length,
    });
    const firstProgress = await Promise.all(progressEvents);
    for (const state of firstProgress) {
        assert.deepEqual(state, firstProgress[0]);
        assert.equal(state.state.phase, "answer-submission");
        assert.equal(JSON.stringify(state).includes(submittedCompletions[1]), false);
    }

    for (let index = 1; index < players.length; index += 1) {
        const response = await emitWithAck(players[index], "fake-answer:submit", {
            completion: submittedCompletions[index + 1],
        });
        assert.equal(response.submissionCount, index + 1);
    }

    const selectedQuestion = questions.find(
        (question) => question.id === gameState.state.prompt.id
    );
    assert.ok(selectedQuestion);
    const completedEvents = clients.map((client) =>
        waitForGameState(client, (state) => state.state.phase === "reveal")
    );
    const votingEvents = clients.map((client) =>
        waitForGameState(client, (state) => state.state.phase === "voting")
    );
    const finalResponse = await emitWithAck(host, "fake-answer:submit", {
        completion: submittedCompletions[0],
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
        assert.equal(state.state.options.length, clients.length);
        assert.equal(
            state.state.options.some(
                ({ completion }) => completion === submittedCompletions[index]
            ),
            false
        );
        assert.equal(
            state.state.options.some(
                ({ completion }) => completion === selectedQuestion.correctCompletion
            ),
            true
        );
        assert.ok(
            state.state.options.every(
                (option) => Object.keys(option).sort().join(",") === "completion,id"
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

test("two-player fake-answer reveal hides own answer and voting reaches waiting-for-results", async (context) => {
    const harness = await createHarness(context);
    const { host, players, questionState, gameState } = await startFakeAnswer(
        harness,
        { playerCount: 2 }
    );
    const clients = [host, ...players];

    assert.equal(questionState.gameId, "fake-answer");
    assert.equal(questionState.state.phase, "question");
    assert.equal(questionState.state.currentRound, 1);
    assert.equal(questionState.state.totalRounds, 5);
    assert.equal(typeof questionState.state.prompt.text, "string");
    assert.equal(gameState.state.phase, "answer-submission");
    assert.equal(gameState.state.playerCount, 2);

    const question = questions.find(({ id }) => id === questionState.state.prompt.id);
    assert.ok(question);
    assert.equal(JSON.stringify(questionState).includes(question.correctCompletion), false);
    assert.equal(JSON.stringify(gameState).includes(question.correctCompletion), false);

    const firstResponse = await emitWithAck(host, "fake-answer:submit", {
        completion: "A secret underwater library.",
    });
    assert.deepEqual(firstResponse, {
        submitted: true,
        submissionCount: 1,
        playerCount: 2,
    });
    assert.equal(
        (await emitWithAck(host, "fake-answer:submit", {
            completion: "A second answer from the host.",
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
        completion: ownCompletions[1],
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
        assert.equal(state.state.options.length, 2);
        assert.equal(
            state.state.options.some(({ completion }) => completion === ownCompletions[index]),
            false
        );
        assert.equal(
            state.state.options.some(({ completion }) => completion === question.correctCompletion),
            true
        );
        assert.ok(
            state.state.options.every(
                (option) =>
                    Object.keys(option).sort().join(",") === "completion,id" &&
                    /^[0-9a-f-]{36}$/i.test(option.id)
            )
        );
    }
    assert.notDeepEqual(
        revealStates[0].state.options.map(({ id }) => id),
        revealStates[1].state.options.map(({ id }) => id)
    );

    const votingStates = await Promise.all(votingEvents);
    for (let index = 0; index < votingStates.length; index += 1) {
        const state = votingStates[index];
        assert.equal(state.state.phase, "voting");
        assert.equal(state.state.voteCount, 0);
        assert.deepEqual(state.state.options, revealStates[index].state.options);
        assert.equal(JSON.stringify(state).includes(question.correctCompletion), true);
        assert.equal(JSON.stringify(state).includes(ownCompletions[index]), false);
    }

    const hostOwnOptionId = votingStates[1].state.options.find(
        ({ completion }) => completion === ownCompletions[0]
    ).id;
    assert.equal(
        (await emitWithAck(host, "fake-answer:vote", { optionId: hostOwnOptionId })).error.code,
        "OWN_ANSWER_NOT_ALLOWED"
    );
    assert.equal(
        (await emitWithAck(host, "fake-answer:vote", { optionId: "fabricated-option" })).error.code,
        "INVALID_OPTION"
    );
    assert.equal(
        (await emitWithAck(host, "fake-answer:vote", {
            optionId: votingStates[0].state.options[0].id,
            playerId: players[0].id,
        })).error.code,
        "INVALID_REQUEST"
    );
    const outsider = await harness.connect();
    assert.equal(
        (await emitWithAck(outsider, "fake-answer:vote", { optionId: "outsider" })).error.code,
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
    const hostVote = await emitWithAck(host, "fake-answer:vote", {
        optionId: votingStates[0].state.options[0].id,
    });
    assert.deepEqual(hostVote, { voted: true, voteCount: 1, playerCount: 2 });
    const guestVoteProgress = await waitForGameState(
        players[0],
        (state) => state.state.phase === "voting" && state.state.voteCount === 1
    );
    assert.equal(guestVoteProgress.state.voteCount, 1);
    assert.equal(Object.hasOwn(guestVoteProgress.state, "votes"), false);
    assert.equal(
        (await emitWithAck(host, "fake-answer:vote", {
            optionId: votingStates[0].state.options[1].id,
        })).error.code,
        "ALREADY_VOTED"
    );
    const guestVote = await emitWithAck(players[0], "fake-answer:vote", {
        optionId: votingStates[1].state.options[0].id,
    });
    assert.deepEqual(guestVote, { voted: true, voteCount: 2, playerCount: 2 });
    for (const state of await Promise.all([hostWaiting, guestWaiting])) {
        assert.equal(state.state.phase, "waiting-for-results");
        assert.equal(state.state.voteCount, 2);
        assert.equal(Object.hasOwn(state.state, "options"), false);
        assert.equal(Object.hasOwn(state.state, "votes"), false);
        assert.equal(Object.hasOwn(state.state, "correctOptionId"), false);
        assert.equal(state.state.prompt, null);
        assert.equal(JSON.stringify(state).includes(question.correctCompletion), false);
    }
});

test("fake-answer rejects empty, long, correct, duplicate, malformed, and impersonated submissions", async (context) => {
    const harness = await createHarness(context);
    const { host, players, gameState } = await startFakeAnswer(harness);
    const question = questions.find(
        (entry) => entry.id === gameState.state.prompt.id
    );
    assert.ok(question);

    for (const completion of ["   ", "x".repeat(161)]) {
        const response = await emitWithAck(players[0], "fake-answer:submit", {
            completion,
        });
        assert.equal(response.error.code, "INVALID_COMPLETION");
    }

    const correctResponse = await emitWithAck(players[0], "fake-answer:submit", {
        completion: `  ${question.correctCompletion.toUpperCase()}  `,
    });
    assert.equal(correctResponse.error.code, "CORRECT_COMPLETION_NOT_ALLOWED");

    const impersonation = await emitWithAck(players[0], "fake-answer:submit", {
        completion: "I am borrowing another player's identity",
        playerId: players[1].id,
    });
    assert.equal(impersonation.error.code, "INVALID_REQUEST");
    const clientCorrectAnswer = await emitWithAck(players[0], "fake-answer:submit", {
        completion: "A made up completion",
        correctCompletion: question.correctCompletion,
    });
    assert.equal(clientCorrectAnswer.error.code, "INVALID_REQUEST");

    for (const payload of [null, [], "malformed", {}, { completion: 1 }]) {
        const response = await emitWithAck(host, "fake-answer:submit", payload);
        assert.equal(response.error.code, "INVALID_REQUEST");
    }

    const accepted = await emitWithAck(players[0], "fake-answer:submit", {
        completion: "  A believable invented detail.  ",
    });
    assert.equal(accepted.submitted, true);
    const duplicate = await emitWithAck(players[0], "fake-answer:submit", {
        completion: "A different answer",
    });
    assert.equal(duplicate.error.code, "ALREADY_SUBMITTED");

    const outsider = await harness.connect();
    const outsideRoom = await emitWithAck(outsider, "fake-answer:submit", {
        completion: "Not a participant",
    });
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
