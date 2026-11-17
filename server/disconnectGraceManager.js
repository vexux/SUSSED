const DISCONNECT_GRACE_PERIOD_MS = 90_000;

class DisconnectGraceManager {
    constructor({
        now = Date.now,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout
    } = {}) {
        this.now = now;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.entries = new Map();
        this.nextGeneration = 0;
    }

    schedule({ playerId, roomCode, roomInstanceId, disconnectedAt, onExpire }) {
        if (
            typeof playerId !== "string" || !playerId ||
            typeof roomCode !== "string" || !roomCode ||
            typeof roomInstanceId !== "string" || !roomInstanceId ||
            typeof disconnectedAt !== "number" || !Number.isFinite(disconnectedAt) ||
            typeof onExpire !== "function"
        ) {
            throw new TypeError("A player, room instance, disconnect time, and expiry handler are required.");
        }

        const existing = this.entries.get(playerId);
        if (existing?.roomCode === roomCode && existing.roomInstanceId === roomInstanceId) {
            return existing;
        }
        if (existing) this.cancelPlayer(playerId);

        const generation = ++this.nextGeneration;
        const entry = {
            playerId,
            roomCode,
            roomInstanceId,
            disconnectedAt,
            generation,
            timer: null,
            onExpire
        };
        this.entries.set(playerId, entry);
        entry.timer = this.setTimeoutFn(() => {
            if (this.entries.get(playerId) === entry) {
                entry.onExpire(entry);
            }
        }, DISCONNECT_GRACE_PERIOD_MS);
        entry.timer?.unref?.();
        return entry;
    }

    isCurrent(entry) {
        return this.entries.get(entry.playerId) === entry;
    }

    finish(entry) {
        if (!this.isCurrent(entry)) return false;
        this.entries.delete(entry.playerId);
        if (entry.timer !== null) this.clearTimeoutFn(entry.timer);
        return true;
    }

    cancelPlayer(playerId, roomInstanceId) {
        const entry = this.entries.get(playerId);
        if (!entry || (roomInstanceId && entry.roomInstanceId !== roomInstanceId)) {
            return null;
        }
        this.finish(entry);
        return entry;
    }

    cancelRoom(roomCode, roomInstanceId) {
        let cancelled = 0;
        for (const entry of this.entries.values()) {
            if (entry.roomCode === roomCode && entry.roomInstanceId === roomInstanceId) {
                if (this.finish(entry)) cancelled += 1;
            }
        }
        return cancelled;
    }

    cancelAll() {
        for (const entry of this.entries.values()) this.finish(entry);
    }

    get size() {
        return this.entries.size;
    }
}

module.exports = { DisconnectGraceManager, DISCONNECT_GRACE_PERIOD_MS };
