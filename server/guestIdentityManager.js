const {
    createHash,
    randomBytes,
    randomUUID,
} = require("node:crypto");

const RECOVERY_CREDENTIAL_BYTES = 32;
const RECOVERY_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REPLAY_MARKER_TTL_MS = 24 * 60 * 60 * 1000;
const PERSONAL_ROOM_PREFIX = "sussed:player:";

class GuestIdentityError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "GuestIdentityError";
        this.code = code;
    }
}

function hashRecoveryCredential(credential) {
    return createHash("sha256").update(credential, "utf8").digest("hex");
}

function createRecoveryCredential() {
    return randomBytes(RECOVERY_CREDENTIAL_BYTES).toString("hex");
}

function getPersonalRoomName(playerId) {
    return `${PERSONAL_ROOM_PREFIX}${playerId}`;
}

class GuestIdentityManager {
    constructor({ now = Date.now, generatePlayerId = randomUUID, generateCredential = createRecoveryCredential } = {}) {
        this.now = now;
        this.generatePlayerId = generatePlayerId;
        this.generateCredential = generateCredential;
        this.records = new Map();
        this.credentials = new Map();
        this.retiredCredentials = new Map();
        this.activeSockets = new Map();
        this.socketPlayers = new Map();
        this.pendingSockets = new Map();
    }

    beginNewSession(socketId) {
        this.#validateSocketId(socketId);
        this.#purgeExpired();
        const playerId = this.generatePlayerId();
        const credential = this.generateCredential();
        if (typeof playerId !== "string" || playerId.length === 0 || this.records.has(playerId)) {
            throw this.#internalError();
        }
        const pendingCredentialHash = hashRecoveryCredential(credential);
        this.records.set(playerId, {
            playerId,
            credentialHash: null,
            pendingCredentialHash,
            pendingSocketId: socketId,
            pendingKind: "issuance",
            activeSocketId: null,
            expiresAt: this.now() + RECOVERY_CREDENTIAL_TTL_MS,
        });
        this.pendingSockets.set(socketId, playerId);
        return { playerId, recoveryCredential: credential, rotated: false };
    }

    beginRecovery(socketId, credential) {
        this.#validateSocketId(socketId);
        this.#purgeExpired();
        if (!this.#isCredentialFormatValid(credential)) {
            throw this.#error("INVALID_RECOVERY_CREDENTIAL", "The guest recovery credential is invalid.");
        }
        const credentialHash = hashRecoveryCredential(credential);
        if (this.retiredCredentials.has(credentialHash)) {
            throw this.#error("RECOVERY_REPLAYED", "That guest recovery credential has already been used.");
        }
        const playerId = this.credentials.get(credentialHash);
        const record = playerId ? this.records.get(playerId) : null;
        if (!record || record.credentialHash !== credentialHash) {
            throw this.#error("INVALID_RECOVERY_CREDENTIAL", "The guest recovery credential is invalid or expired.");
        }
        if (record.pendingSocketId) {
            throw this.#error("RECOVERY_IN_PROGRESS", "Recovery for this guest is already in progress.");
        }
        if (record.activeSocketId) {
            throw this.#error("PLAYER_ALREADY_CONNECTED", "This guest identity is already connected.");
        }
        if (record.expiresAt <= this.now()) {
            this.#deleteRecord(record);
            throw this.#error("INVALID_RECOVERY_CREDENTIAL", "The guest recovery credential is invalid or expired.");
        }

        const replacement = this.generateCredential();
        record.pendingCredentialHash = hashRecoveryCredential(replacement);
        record.pendingSocketId = socketId;
        record.pendingKind = "rotation";
        this.pendingSockets.set(socketId, playerId);
        return { playerId, recoveryCredential: replacement, rotated: true };
    }

    activateSocket(socketId, credentialStored) {
        const playerId = this.pendingSockets.get(socketId);
        const record = playerId ? this.records.get(playerId) : null;
        if (!record || record.pendingSocketId !== socketId || !record.pendingCredentialHash) {
            throw this.#error("RECOVERY_INTERNAL_ERROR", "The guest session could not be activated.");
        }
        if (credentialStored !== true) {
            this.abortSocket(socketId);
            throw this.#error("RECOVERY_STORAGE_UNAVAILABLE", "The guest recovery credential could not be stored.");
        }
        if (record.activeSocketId) {
            this.abortSocket(socketId);
            throw this.#error("PLAYER_ALREADY_CONNECTED", "This guest identity is already connected.");
        }

        if (record.credentialHash) {
            this.credentials.delete(record.credentialHash);
            this.retiredCredentials.set(
                record.credentialHash,
                this.now() + REPLAY_MARKER_TTL_MS,
            );
        }
        record.credentialHash = record.pendingCredentialHash;
        record.pendingCredentialHash = null;
        record.pendingSocketId = null;
        record.pendingKind = null;
        record.activeSocketId = socketId;
        record.expiresAt = this.now() + RECOVERY_CREDENTIAL_TTL_MS;
        this.pendingSockets.delete(socketId);
        this.credentials.set(record.credentialHash, playerId);
        this.activeSockets.set(playerId, socketId);
        this.socketPlayers.set(socketId, playerId);
        return playerId;
    }

    abortSocket(socketId) {
        const playerId = this.pendingSockets.get(socketId);
        if (!playerId) return false;
        const record = this.records.get(playerId);
        this.pendingSockets.delete(socketId);
        if (!record || record.pendingSocketId !== socketId) return false;
        const wasIssuance = record.pendingKind === "issuance";
        record.pendingCredentialHash = null;
        record.pendingSocketId = null;
        record.pendingKind = null;
        if (wasIssuance) {
            this.records.delete(playerId);
        }
        return true;
    }

    releaseSocket(socketId) {
        this.abortSocket(socketId);
        const playerId = this.socketPlayers.get(socketId);
        if (!playerId) return null;
        this.socketPlayers.delete(socketId);
        if (this.activeSockets.get(playerId) === socketId) {
            this.activeSockets.delete(playerId);
        }
        const record = this.records.get(playerId);
        if (record?.activeSocketId === socketId) {
            record.activeSocketId = null;
        }
        this.#purgeExpired();
        return playerId;
    }

    getSocketId(playerId) {
        return this.activeSockets.get(playerId) ?? null;
    }

    isActiveSocket(playerId, socketId) {
        return this.activeSockets.get(playerId) === socketId;
    }

    getPlayerId(socketId) {
        return this.socketPlayers.get(socketId) ?? this.pendingSockets.get(socketId) ?? null;
    }

    invalidatePlayer(playerId) {
        const record = this.records.get(playerId);
        if (!record) return false;
        this.#deleteRecord(record);
        return true;
    }

    #validateSocketId(socketId) {
        if (typeof socketId !== "string" || socketId.length === 0) {
            throw this.#internalError();
        }
        if (this.socketPlayers.has(socketId) || this.pendingSockets.has(socketId)) {
            throw this.#error("RECOVERY_IN_PROGRESS", "This socket already has a guest session.");
        }
    }

    #isCredentialFormatValid(credential) {
        return typeof credential === "string" && /^[0-9a-f]{64}$/u.test(credential);
    }

    #deleteRecord(record) {
        this.records.delete(record.playerId);
        if (record.credentialHash) {
            this.credentials.delete(record.credentialHash);
        }
        if (record.pendingSocketId) {
            this.pendingSockets.delete(record.pendingSocketId);
        }
        if (record.activeSocketId) {
            this.activeSockets.delete(record.playerId);
            this.socketPlayers.delete(record.activeSocketId);
        }
    }

    #purgeExpired() {
        const now = this.now();
        for (const [hash, expiresAt] of this.retiredCredentials) {
            if (expiresAt <= now) this.retiredCredentials.delete(hash);
        }
        for (const record of this.records.values()) {
            if (
                record.expiresAt <= now &&
                !record.activeSocketId &&
                !record.pendingSocketId
            ) {
                this.#deleteRecord(record);
            }
        }
    }

    #error(code, message) {
        return new GuestIdentityError(code, message);
    }

    #internalError() {
        return this.#error("RECOVERY_INTERNAL_ERROR", "The guest session could not be created.");
    }
}

function createSocketIdentityMiddleware(identityManager) {
    return (socket, next) => {
        try {
            const auth = socket.handshake.auth;
            const hasCredential = auth && Object.hasOwn(auth, "recoveryCredential");
            const session = hasCredential
                ? identityManager.beginRecovery(socket.id, auth.recoveryCredential)
                : identityManager.beginNewSession(socket.id);
            socket.data.playerId = session.playerId;
            socket.data.pendingRecoveryCredential = session.recoveryCredential;
            socket.data.recoveryCredentialRotated = session.rotated;
            next();
        } catch (error) {
            const failure = error instanceof GuestIdentityError
                ? error
                : new GuestIdentityError("RECOVERY_INTERNAL_ERROR", "The guest session could not be created.");
            const socketError = new Error(failure.message);
            socketError.data = { code: failure.code };
            next(socketError);
        }
    };
}

module.exports = {
    GuestIdentityError,
    GuestIdentityManager,
    PERSONAL_ROOM_PREFIX,
    RECOVERY_CREDENTIAL_BYTES,
    RECOVERY_CREDENTIAL_TTL_MS,
    createSocketIdentityMiddleware,
    getPersonalRoomName,
    hashRecoveryCredential,
};
