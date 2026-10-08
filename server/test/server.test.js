const assert = require("node:assert/strict");
const test = require("node:test");
const { io: createClient } = require("socket.io-client");
const { port: defaultPort } = require("../config");
const roomManager = require("../roomManager");
const { startServer } = require("../server");

test("starts the server and handles create-room over Socket.IO", async (context) => {
    assert.equal(defaultPort, 3000);

    const io = startServer(0);
    let client;
    const createdRooms = [];
    const originalCreateRoom = roomManager.createRoom;
    roomManager.createRoom = (playerId) => {
        const room = originalCreateRoom(playerId);
        createdRooms.push(room);
        return room;
    };

    context.after(async () => {
        roomManager.createRoom = originalCreateRoom;
        for (const room of createdRooms) {
            roomManager.removeRoom(room.code);
        }
        if (client) {
            client.close();
        }
        await new Promise((resolve) => io.close(resolve));
    });

    await new Promise((resolve, reject) => {
        io.httpServer.once("listening", resolve);
        io.httpServer.once("error", reject);
    });

    const address = io.httpServer.address();
    assert.ok(address && typeof address === "object");
    assert.ok(address.port > 0);

    client = createClient(`http://127.0.0.1:${address.port}`, {
        reconnection: false,
        timeout: 3000,
    });
    await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
    });

    const acknowledgement = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("create-room acknowledgement timed out")),
            3000
        );
        client.emit("create-room", (response) => {
            clearTimeout(timeout);
            resolve(response);
        });
    });

    const room = createdRooms.at(-1);
    assert.ok(room);
    assert.deepEqual(acknowledgement, { roomCode: room.code });

    const serverSocket = io.sockets.sockets.get(client.id);
    assert.ok(serverSocket);
    assert.ok(serverSocket.rooms.has(room.code));
    assert.ok(io.sockets.adapter.rooms.get(room.code).has(client.id));
});

test("removes a room if the creator socket cannot join it", async (context) => {
    const io = startServer(0);
    let client;
    let createdRoom;
    const originalCreateRoom = roomManager.createRoom;
    roomManager.createRoom = (playerId) => {
        createdRoom = originalCreateRoom(playerId);
        return createdRoom;
    };

    context.after(async () => {
        roomManager.createRoom = originalCreateRoom;
        if (client) {
            client.close();
        }
        await new Promise((resolve) => io.close(resolve));
    });

    await new Promise((resolve, reject) => {
        io.httpServer.once("listening", resolve);
        io.httpServer.once("error", reject);
    });
    const address = io.httpServer.address();
    assert.ok(address && typeof address === "object");

    let serverSocket;
    io.on("connection", (socket) => {
        serverSocket = socket;
    });
    client = createClient(`http://127.0.0.1:${address.port}`, {
        reconnection: false,
        timeout: 3000,
    });
    await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
    });

    assert.ok(serverSocket);
    serverSocket.join = () => Promise.reject(new Error("simulated join failure"));
    const originalConsoleError = console.error;
    console.error = () => {};
    let acknowledgement;
    try {
        acknowledgement = await new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error("create-room failure acknowledgement timed out")),
                3000
            );
            client.emit("create-room", (response) => {
                clearTimeout(timeout);
                resolve(response);
            });
        });
    } finally {
        console.error = originalConsoleError;
    }

    assert.ok(createdRoom);
    assert.deepEqual(acknowledgement, { error: "Unable to create room." });
    assert.equal(roomManager.removeRoom(createdRoom.code), false);
});
