const assert = require("node:assert/strict");
const test = require("node:test");
const { io: createClient } = require("socket.io-client");
const { port: defaultPort } = require("../config");
const gameManager = require("../gameManager");
const { questions } = require("../questionBank");
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

function waitForGameState(client) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.off("game-state", onGameState);
            reject(new Error("game-state event timed out"));
        }, 3000);
        function onGameState(gameState) {
            clearTimeout(timeout);
            client.off("game-state", onGameState);
            resolve(gameState);
        }
        client.on("game-state", onGameState);
    });
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
        "playerCount",
        "players",
        "roomCode",
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
    const guest = await harness.connect();
    const created = await emitWithAck(host, "create-room", {
        playerName: "Host",
    });
    harness.trackRoom(created.roomCode);
    await emitWithAck(guest, "join-room", {
        roomCode: created.roomCode,
        playerName: "Guest",
    });

    const notReady = await emitWithAck(host, "start-game");
    assert.equal(notReady.error.code, "PLAYERS_NOT_READY");
    await emitWithAck(guest, "set-ready", { isReady: true });
    const response = await emitWithAck(host, "start-game");
    assert.deepEqual(response, { starting: true });
});

test("host can start when requirements are met and a second start is rejected", async (context) => {
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
        guest.once("game-starting", (payload) => {
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

test("host start initializes and broadcasts the same safe question state to every player", async (context) => {
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

    const hostGameState = waitForGameState(host);
    const guestGameState = waitForGameState(guest);
    assert.deepEqual(await emitWithAck(host, "start-game"), { starting: true });
    const hostState = await hostGameState;
    const guestState = await guestGameState;
    const game = gameManager.getGame(created.roomCode);

    assert.deepEqual(hostState, guestState);
    assert.equal(hostState.roomCode, created.roomCode);
    assert.equal(hostState.phase, "question");
    assert.equal(hostState.currentRound, 1);
    assert.equal(hostState.totalRounds, 5);
    assert.equal(game.phase, "question");
    assert.equal(game.currentRound, 1);
    assert.equal(game.totalRounds, 5);
    assert.deepEqual(gameManager.GAME_PHASES, [
        "question",
        "answer-submission",
        "reveal",
        "voting",
        "results",
        "finished",
    ]);
    assert.deepEqual(
        game.players.map(({ id, name }) => ({ id, name })),
        [
            { id: host.id, name: "Host" },
            { id: guest.id, name: "Guest" },
        ]
    );
    assert.ok(questions.length >= game.totalRounds);
    assert.ok(questions.some((question) => question.id === hostState.question.id));
    assert.deepEqual(Object.keys(hostState).sort(), [
        "currentRound",
        "phase",
        "question",
        "roomCode",
        "totalRounds",
    ]);
    assert.deepEqual(Object.keys(hostState.question).sort(), ["id", "text"]);
    assert.equal(
        Object.hasOwn(hostState.question, "correctAnswer"),
        false
    );
    assert.equal(
        JSON.stringify(hostState).includes(game.currentQuestion.correctAnswer),
        false
    );

    assert.equal(
        (await emitWithAck(guest, "start-game")).error.code,
        "NOT_HOST"
    );
});

test("clients cannot choose the question and malformed start payloads are rejected safely", async (context) => {
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
        (await emitWithAck(guest, "start-game", { questionId: "client-choice" }))
            .error.code,
        "INVALID_REQUEST"
    );
    assert.equal((await emitWithAck(host, "start-game", null)).error.code, "INVALID_REQUEST");

    const hostGameState = waitForGameState(host);
    const guestGameState = waitForGameState(guest);
    await emitWithAck(host, "start-game");
    const [hostState, guestState] = await Promise.all([hostGameState, guestGameState]);
    assert.deepEqual(hostState.question, guestState.question);
    assert.notEqual(hostState.question.id, "client-choice");
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
