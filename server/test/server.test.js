const assert = require("node:assert/strict");
const test = require("node:test");
const { io: createClient } = require("socket.io-client");
const { port: defaultPort } = require("../config");
const gameManager = require("../gameManager");
const { questions } = require("../games/fake-answer/questionBank");
const fakeAnswerSocketHandlers = require("../games/fake-answer/socketHandlers");
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
            fakeAnswerSocketHandlers.clearActionPhaseTimeout(roomCode);
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

async function completeSocketRound(host, players, gameState) {
    const clients = [host, ...players];
    const question = questions.find(
        ({ id }) => id === gameState.state.prompt.id
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

test("disconnect during an active game aborts the round and recovers remaining players to lobby", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 3 });
    const originalHostSocket = harness.io.sockets.sockets.get(game.host.id);
    const room = roomManager.getRoom(game.roomCode);
    const originalSessionId = game.gameState.sessionId;
    const hostUpdate = waitForLobby(
        game.players[0],
        (lobby) => lobby.status === "lobby" && lobby.playerCount === 2
    );
    const otherPlayerUpdate = waitForLobby(
        game.players[1],
        (lobby) => lobby.status === "lobby" && lobby.playerCount === 2
    );
    const disconnected = new Promise((resolve) =>
        originalHostSocket.once("disconnect", resolve)
    );

    game.host.disconnect();
    await disconnected;
    const [firstLobby, secondLobby] = await Promise.all([
        hostUpdate,
        otherPlayerUpdate,
    ]);

    assert.deepEqual(firstLobby, secondLobby);
    assert.equal(firstLobby.roomCode, game.roomCode);
    assert.equal(firstLobby.status, "lobby");
    assert.equal(firstLobby.playerCount, 2);
    assert.equal(firstLobby.players[0].id, game.players[0].id);
    assert.equal(firstLobby.players[0].isHost, true);
    assert.ok(firstLobby.players.every((player) => !player.isReady));
    assert.equal(roomManager.getRoom(game.roomCode), room);
    assert.equal(room.hostId, game.players[0].id);
    assert.equal(room.players.length, 2);
    assert.equal(roomManager.getPlayerRoom(game.host.id), null);
    assert.throws(
        () => roomManager.setPlayerReady(game.host.id, true),
        { code: "NOT_IN_ROOM" }
    );
    assert.throws(
        () => gameManager.getPublicGameState(game.roomCode, game.players[0].id),
        { code: "GAME_NOT_ACTIVE" }
    );
    assert.equal(
        (await emitWithAck(game.players[0], "fake-answer:submit", {
            completion: "Cannot be accepted after a game-aborting disconnect",
            sessionId: originalSessionId,
            roundId: game.gameState.state.roundId,
        })).error.code,
        "GAME_NOT_ACTIVE"
    );

    await emitWithAck(game.players[0], "leave-room");
    await emitWithAck(game.players[1], "leave-room");
    assert.equal(roomManager.getRoom(game.roomCode), null);
    assert.throws(
        () => gameManager.getPublicGameState(game.roomCode, game.players[0].id),
        { code: "GAME_NOT_ACTIVE" }
    );
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
        "sessionId",
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

test("an incomplete action phase expires safely to the same unready lobby without scoring", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 2 });
    const room = roomManager.getRoom(game.roomCode);
    assert.ok(room);
    const playerIds = room.players.map(({ id }) => id);

    assert.equal(
        fakeAnswerSocketHandlers.expireActionPhase(
            harness.io,
            game.roomCode,
            `${game.gameState.sessionId}-stale`,
            game.gameState.state.roundId,
            "answer-submission"
        ),
        false
    );
    assert.equal(room.status, "starting");

    const hostLobby = waitForLobby(
        game.host,
        (lobby) => lobby.status === "lobby"
    );
    const guestLobby = waitForLobby(
        game.players[0],
        (lobby) => lobby.status === "lobby"
    );
    const aborted = new Promise((resolve) => {
        game.host.once("game-aborted", resolve);
    });
    assert.equal(
        fakeAnswerSocketHandlers.expireActionPhase(
            harness.io,
            game.roomCode,
            game.gameState.sessionId,
            game.gameState.state.roundId,
            "answer-submission"
        ),
        true
    );

    const [hostState, guestState, abortNotice] = await Promise.all([
        hostLobby,
        guestLobby,
        aborted,
    ]);
    assert.deepEqual(hostState, guestState);
    assert.equal(hostState.roomCode, game.roomCode);
    assert.deepEqual(hostState.players.map(({ id }) => id), playerIds);
    assert.equal(hostState.players.every(({ isReady }) => !isReady), true);
    assert.match(abortNotice.message, /not completed in time/);
    assert.throws(
        () => gameManager.getPublicGameState(game.roomCode, game.host.id),
        { code: "GAME_NOT_ACTIVE" }
    );
    fakeAnswerSocketHandlers.clearActionPhaseTimeout(
        game.roomCode,
        game.gameState.sessionId
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
        "roundId",
        "submissionCount",
        "totalRounds",
    ]);

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
    for (const state of firstProgress) {
        assert.deepEqual(state, firstProgress[0]);
        assert.equal(state.state.phase, "answer-submission");
        assert.equal(JSON.stringify(state).includes(submittedCompletions[1]), false);
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
                ({ completion }) => completion === submittedCompletions[index]
            ).isOwnAnswer,
            true
        );
        assert.equal(
            state.state.options.some(
                ({ completion }) => completion === selectedQuestion.correctCompletion
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

test("two-player fake-answer reveal shows the own answer without revealing authors and voting reaches results", async (context) => {
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
                ({ completion }) => completion === ownCompletions[index]
            ).isOwnAnswer,
            true
        );
        assert.equal(
            state.state.options.some(({ completion }) => completion === question.correctCompletion),
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
        assert.equal(JSON.stringify(state).includes(question.correctCompletion), true);
        assert.equal(JSON.stringify(state).includes(ownCompletions[index]), true);
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
        assert.equal(Object.hasOwn(state.state, "options"), false);
        assert.equal(Object.hasOwn(state.state, "votes"), false);
        assert.equal(Object.hasOwn(state.state, "correctOptionId"), false);
        assert.equal(state.state.prompt, null);
        assert.equal(JSON.stringify(state).includes(question.correctCompletion), false);
    }
    const resultsStates = await Promise.all([hostResults, guestResults]);
    for (const state of resultsStates) {
        assert.equal(state.state.results.correctCompletion, question.correctCompletion);
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
                (sum, player) => sum + (player.voteCorrect ? 1 : 0),
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

test("fake-answer progresses through five scored rounds, preserves a final tie, and keeps the room", async (context) => {
    const harness = await createHarness(context);
    const game = await startFakeAnswer(harness, { playerCount: 2 });
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
                { totalScore: round, rank: 1 },
                { totalScore: round, rank: 1 },
            ]);
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
            assert.equal((await guestProgress).state.viewerReadyToContinue, false);

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
        }
    }

    assert.equal(promptIds.size, roundGameState.state.totalRounds);
    assert.equal(roomManager.getRoom(game.roomCode), room);
    assert.equal(room.hostId, initialHostId);
    assert.deepEqual(room.players.map(({ id }) => id), initialPlayerIds);
    assert.equal(room.selectedGameId, "fake-answer");
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

    const nonHostLobby = waitForLobby(game.players[0], (lobby) => lobby.status === "lobby");
    const hostLobby = waitForLobby(game.host, (lobby) => lobby.status === "lobby");
    const returnResponses = await Promise.all([
        emitWithAck(game.host, "return-to-lobby", { sessionId: finalSessionId }),
        emitWithAck(game.host, "return-to-lobby", { sessionId: finalSessionId }),
    ]);
    assert.deepEqual(returnResponses[0], { returned: true });
    assert.equal(returnResponses[1].error.code, "ROOM_NOT_IN_GAME");
    const [hostLobbyState, nonHostLobbyState] = await Promise.all([
        hostLobby,
        nonHostLobby,
    ]);
    assert.deepEqual(hostLobbyState, nonHostLobbyState);
    assert.equal(hostLobbyState.roomCode, game.roomCode);
    assert.equal(hostLobbyState.status, "lobby");
    assert.equal(hostLobbyState.selectedGameId, "fake-answer");
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
    assert.equal(
        (await emitWithAck(game.host, "start-game")).error.code,
        "PLAYERS_NOT_READY"
    );

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
    assert.deepEqual(await emitWithAck(game.host, "start-game"), { starting: true });
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

test("fake-answer rejects empty, long, correct, duplicate, malformed, and impersonated submissions", async (context) => {
    const harness = await createHarness(context);
    const { host, players, gameState } = await startFakeAnswer(harness);
    const question = questions.find(
        (entry) => entry.id === gameState.state.prompt.id
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
    assert.equal(correctResponse.error.code, "CORRECT_COMPLETION_NOT_ALLOWED");

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
