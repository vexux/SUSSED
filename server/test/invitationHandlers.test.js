const assert = require("node:assert/strict");
const test = require("node:test");
const roomManager = require("../roomManager");
const { registerInvitationHandlers } = require("../invitationHandlers");

function createSocket(id, accountId) {
    const handlers = new Map();
    return {
        id,
        data: accountId ? { accountId } : {},
        on(event, handler) {
            handlers.set(event, handler);
        },
        join() {
            return Promise.resolve();
        },
        leave() {
            return Promise.resolve();
        },
        emit(event, payload) {
            const handler = handlers.get(event);
            assert.ok(handler, `missing event handler ${event}`);
            return new Promise((resolve) => handler(payload, resolve));
        },
    };
}

function createIo() {
    const events = [];
    return {
        events,
        to(target) {
            return {
                emit(event, payload) {
                    events.push({ target, event, payload });
                },
            };
        },
    };
}

test("an authenticated non-host room participant can invite an existing friend", async (context) => {
    const room = roomManager.createRoom("invitation-host", "Host");
    const participant = roomManager.joinRoom(room.code, "invitation-participant", "Player");
    context.after(() => roomManager.removeRoom(room.code));
    const socket = createSocket(participant.players[1].id, "verified-account");
    const calls = [];
    registerInvitationHandlers(createIo(), socket, {
        async sendGameInvitation(...args) {
            calls.push(args);
            return "33333333-3333-4333-8333-333333333333";
        },
    });

    assert.deepEqual(await socket.emit("send-game-invitation", { handle: "friend1" }), {
        invitationId: "33333333-3333-4333-8333-333333333333",
    });
    assert.deepEqual(calls, [[
        "verified-account",
        "friend1",
        room.code,
        room.publicRoomId,
    ]]);
});

test("guest sockets and sockets outside the room cannot create game invitations", async (context) => {
    const room = roomManager.createRoom("invitation-auth-host", "Host");
    context.after(() => roomManager.removeRoom(room.code));
    let calls = 0;
    const repository = {
        async sendGameInvitation() {
            calls += 1;
            return "33333333-3333-4333-8333-333333333333";
        },
    };
    const guest = createSocket("invitation-guest", null);
    registerInvitationHandlers(createIo(), guest, repository);
    assert.equal((await guest.emit("send-game-invitation", { handle: "friend1" })).error.code, "AUTH_REQUIRED");

    const unrelated = createSocket("unrelated-socket", "verified-account");
    registerInvitationHandlers(createIo(), unrelated, repository);
    assert.equal((await unrelated.emit("send-game-invitation", { handle: "friend1" })).error.code, "ROOM_NOT_AVAILABLE");
    assert.equal(calls, 0);
});

test("invitation acceptance joins only the intended recipient and marks success after joining", async (context) => {
    const room = roomManager.createRoom("invitation-join-host", "Host");
    context.after(() => roomManager.removeRoom(room.code));
    const invitationId = "33333333-3333-4333-8333-333333333333";
    const order = [];
    const io = createIo();
    const socket = createSocket("invitation-recipient-socket", "verified-recipient");
    registerInvitationHandlers(io, socket, {
        async getGameInvitation(accountId, id) {
            assert.equal(accountId, "verified-recipient");
            assert.equal(id, invitationId);
            return {
                invitationId,
                roomCode: room.code,
                roomInstanceId: room.publicRoomId,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                status: "pending",
            };
        },
        async setGameInvitationStatus(accountId, id, status) {
            order.push(["status", accountId, id, status, roomManager.getPlayerRoom(socket.id) !== null]);
        },
    });

    const response = await socket.emit("accept-game-invitation", {
        invitationId,
        playerName: "Invitee",
        accountId: "client-controlled-account",
    });
    assert.equal(response.lobby.roomCode, room.code);
    assert.equal(roomManager.getPlayerRoom(socket.id), room);
    assert.deepEqual(order, [["status", "verified-recipient", invitationId, "accepted", true]]);
    assert.ok(io.events.some(({ target, event }) => target === socket.id && event === "lobby-state"));
});

test("expired, missing, full, and failed invitation joins do not leave a room membership", async (context) => {
    const missingRoom = roomManager.createRoom("invitation-missing-host", "Host");
    const fullRoom = roomManager.createRoom("invitation-full-host", "Host");
    context.after(() => {
        roomManager.removeRoom(missingRoom.code);
        roomManager.removeRoom(fullRoom.code);
    });
    for (let index = 1; index < roomManager.MAX_ROOM_CAPACITY; index += 1) {
        roomManager.joinRoom(fullRoom.code, `invitation-full-${index}`, `Player ${index}`);
    }

    async function attempt(roomCode, status = "pending", expiresAt = new Date(Date.now() + 60_000).toISOString(), failStatus = false, roomInstanceId) {
        const socket = createSocket(`invite-attempt-${Math.random()}`, "verified-recipient");
        registerInvitationHandlers(createIo(), socket, {
            async getGameInvitation() {
                return {
                    invitationId: "33333333-3333-4333-8333-333333333333",
                    roomCode,
                    roomInstanceId: roomInstanceId ?? roomManager.getRoom(roomCode)?.publicRoomId,
                    status,
                    expiresAt,
                };
            },
            async setGameInvitationStatus() {
                if (failStatus) throw Object.assign(new Error("database down"), { code: "PROFILE_UNAVAILABLE" });
            },
        });
        return { socket, response: await socket.emit("accept-game-invitation", {
            invitationId: "33333333-3333-4333-8333-333333333333",
            playerName: "Invitee",
        }) };
    }

    const expired = await attempt(missingRoom.code, "expired");
    assert.equal(expired.response.error.code, "INVALID_TRANSITION");
    const absent = await attempt("ZZZZ");
    assert.equal(absent.response.error.code, "ROOM_NOT_AVAILABLE");
    const full = await attempt(fullRoom.code);
    assert.equal(full.response.error.code, "ROOM_FULL");
    const stale = await attempt(
        missingRoom.code,
        "pending",
        new Date(Date.now() + 60_000).toISOString(),
        false,
        "44444444-4444-4444-8444-444444444444",
    );
    assert.equal(stale.response.error.code, "ROOM_NOT_AVAILABLE");
    assert.equal(roomManager.getPlayerRoom(stale.socket.id), null);
    const rollback = await attempt(missingRoom.code, "pending", new Date(Date.now() + 60_000).toISOString(), true);
    assert.equal(rollback.response.error.code, "PROFILE_UNAVAILABLE");
    assert.equal(roomManager.getPlayerRoom(rollback.socket.id), null);
});

test("declining invitations is authorized by socket account metadata", async () => {
    const socket = createSocket("decliner", "verified-recipient");
    const calls = [];
    registerInvitationHandlers(createIo(), socket, {
        async setGameInvitationStatus(...args) {
            calls.push(args);
        },
    });
    assert.deepEqual(await socket.emit("decline-game-invitation", {
        invitationId: "33333333-3333-4333-8333-333333333333",
        accountId: "client-controlled-account",
    }), { ok: true });
    assert.deepEqual(calls, [[
        "verified-recipient",
        "33333333-3333-4333-8333-333333333333",
        "declined",
    ]]);
});
