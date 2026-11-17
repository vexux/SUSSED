const assert = require("node:assert/strict");
const test = require("node:test");
const {
    GuestIdentityManager,
    RECOVERY_CREDENTIAL_TTL_MS,
    createSocketIdentityMiddleware,
    getPersonalRoomName,
    hashRecoveryCredential,
} = require("../guestIdentityManager");

function createDeterministicManager(options = {}) {
    let playerSequence = 0;
    let credentialSequence = 0;
    return new GuestIdentityManager({
        generatePlayerId: () => `player-${++playerSequence}`,
        generateCredential: () => (++credentialSequence).toString(16).padStart(64, "0"),
        ...options,
    });
}

test("new sessions issue cryptographic-format credentials and store only credential hashes", () => {
    const manager = new GuestIdentityManager();
    const session = manager.beginNewSession("transport-a");
    assert.match(session.playerId, /^[0-9a-f-]{36}$/iu);
    assert.match(session.recoveryCredential, /^[0-9a-f]{64}$/iu);
    assert.equal(Buffer.from(session.recoveryCredential, "hex").byteLength, 32);

    const record = manager.records.get(session.playerId);
    assert.equal(record.credentialHash, null);
    assert.equal(record.pendingCredentialHash, hashRecoveryCredential(session.recoveryCredential));
    assert.equal(Object.values(record).includes(session.recoveryCredential), false);
    assert.equal(manager.activateSocket("transport-a", true), session.playerId);
    assert.equal(manager.getPlayerId("transport-a"), session.playerId);
    assert.equal(manager.getSocketId(session.playerId), "transport-a");
});

test("recovery rotates credentials only after storage acknowledgement and rejects replay", () => {
    const manager = createDeterministicManager();
    const original = manager.beginNewSession("transport-a");
    manager.activateSocket("transport-a", true);
    manager.releaseSocket("transport-a");

    const replacement = manager.beginRecovery("transport-b", original.recoveryCredential);
    assert.equal(replacement.playerId, original.playerId);
    assert.equal(replacement.rotated, true);
    assert.notEqual(replacement.recoveryCredential, original.recoveryCredential);
    assert.throws(
        () => manager.beginRecovery("transport-c", original.recoveryCredential),
        { code: "RECOVERY_IN_PROGRESS" },
    );
    manager.activateSocket("transport-b", true);
    manager.releaseSocket("transport-b");

    assert.throws(
        () => manager.beginRecovery("transport-c", original.recoveryCredential),
        { code: "RECOVERY_REPLAYED" },
    );
    assert.equal(
        manager.beginRecovery("transport-c", replacement.recoveryCredential).playerId,
        original.playerId,
    );
});

test("aborted storage acknowledgement retains the prior credential and releases pending sockets", () => {
    const manager = createDeterministicManager();
    const original = manager.beginNewSession("transport-a");
    manager.activateSocket("transport-a", true);
    manager.releaseSocket("transport-a");
    manager.beginRecovery("transport-b", original.recoveryCredential);
    assert.throws(
        () => manager.activateSocket("transport-b", false),
        { code: "RECOVERY_STORAGE_UNAVAILABLE" },
    );
    assert.equal(manager.getPlayerId("transport-b"), null);
    assert.equal(manager.beginRecovery("transport-c", original.recoveryCredential).playerId, original.playerId);
});

test("duplicate active identities and malformed credentials are rejected", () => {
    const manager = createDeterministicManager();
    const session = manager.beginNewSession("transport-a");
    manager.activateSocket("transport-a", true);
    assert.throws(
        () => manager.beginRecovery("transport-b", session.recoveryCredential),
        { code: "PLAYER_ALREADY_CONNECTED" },
    );
    assert.throws(
        () => manager.beginRecovery("transport-b", "not-a-credential"),
        { code: "INVALID_RECOVERY_CREDENTIAL" },
    );
});

test("credentials expire after the configured lifetime", () => {
    let now = 1000;
    const manager = createDeterministicManager({ now: () => now });
    const session = manager.beginNewSession("transport-a");
    manager.activateSocket("transport-a", true);
    manager.releaseSocket("transport-a");
    now += RECOVERY_CREDENTIAL_TTL_MS + 1;

    assert.throws(
        () => manager.beginRecovery("transport-b", session.recoveryCredential),
        { code: "INVALID_RECOVERY_CREDENTIAL" },
    );
    assert.equal(manager.records.has(session.playerId), false);
});

test("identity middleware assigns server metadata and rejects invalid supplied credentials", async () => {
    const manager = createDeterministicManager();
    const middleware = createSocketIdentityMiddleware(manager);
    const socket = { id: "transport-a", handshake: { auth: {} }, data: {} };
    await new Promise((resolve, reject) => {
        middleware(socket, (error) => error ? reject(error) : resolve());
    });
    assert.equal(typeof socket.data.playerId, "string");
    assert.match(socket.data.pendingRecoveryCredential, /^[0-9a-f]{64}$/iu);

    const spoofedSocket = {
        id: "transport-spoofed",
        handshake: { auth: { playerId: "client-selected-player", accountId: "client-selected-account" } },
        data: {},
    };
    await new Promise((resolve, reject) => {
        middleware(spoofedSocket, (error) => error ? reject(error) : resolve());
    });
    assert.notEqual(spoofedSocket.data.playerId, "client-selected-player");
    assert.equal(spoofedSocket.data.accountId, undefined);

    const invalidSocket = {
        id: "transport-b",
        handshake: { auth: { recoveryCredential: "client-selected-account-id" } },
        data: {},
    };
    await new Promise((resolve) => {
        middleware(invalidSocket, (error) => {
            assert.equal(error.data.code, "INVALID_RECOVERY_CREDENTIAL");
            resolve();
        });
    });
    assert.equal(getPersonalRoomName(socket.data.playerId), `sussed:player:${socket.data.playerId}`);
});
