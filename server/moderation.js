const { randomUUID } = require("node:crypto");

const reasons = new Set(["harassment", "spam", "name", "disruption", "other"]);
const retention = 7 * 86400000;

function createModeration() {
    const limits = new Map();
    const reports = new Map();
    const admins = new Set((process.env.MODERATOR_FIREBASE_UIDS ?? "").split(",").map(x => x.trim()).filter(Boolean));
    let nextSweep = 0;
    function allow(id, action, maximum) {
        const now = Date.now();
        if (now >= nextSweep) {
            for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
            nextSweep = now + 60000;
        }
        const key = id + ":" + action;
        let window = limits.get(key);
        if (!window || window.until <= now) limits.set(key, window = { until: now + 60000, count: 0 });
        if (window.count >= maximum) return false;
        window.count++;
        return true;
    }
    function prune() {
        for (const [id, report] of reports) {
            if (Date.now() - report.createdAt >= retention) reports.delete(id);
            else break;
        }
    }
    return { reports, admins, allow, prune };
}

function register(io, socket, rooms, broadcastLobby, broadcastDiscovery, depart, grace) {
    const { playerId, accountId } = socket.data;
    const store = io.moderation;
    const fail = (code, message) => ({ error: { code, message } });
    function event(name, fields, handler, admin = false) {
        socket.on(name, async (payload, ack) => {
            if (typeof ack !== "function") return;
            if (admin && !store.admins.has(accountId)) return ack(fail("FORBIDDEN", "Moderator access required."));
            if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
                Object.keys(payload).length !== fields.length || !fields.every(key => Object.hasOwn(payload, key))) {
                return ack(fail("INVALID_REQUEST", "Invalid request fields."));
            }
            try { ack(await handler(payload, rooms.getPlayerRoom(playerId))); }
            catch { ack(fail("INTERNAL_ERROR", "The operation could not be completed.")); }
        });
    }
    event("set-room-lock", ["locked"], ({ locked }, room) => {
        if (typeof locked !== "boolean") return fail("INVALID_REQUEST", "Expected a lock setting.");
        if (!room || room.hostId !== playerId || room.status !== "lobby") return fail("FORBIDDEN", "Only the lobby host can change the lock.");
        if (room.locked !== locked) {
            room.locked = locked;
            room.revision++;
            broadcastLobby(io, room);
            broadcastDiscovery(io);
        }
        return { lobby: rooms.createLobbyState(room) };
    });
    event("report-player", ["targetPlayerId", "reason"], ({ targetPlayerId, reason }, room) => {
        if (!store.allow(playerId, "report", 5)) return fail("RATE_LIMITED", "Please wait before reporting again.");
        if (!room || playerId === targetPlayerId || !reasons.has(reason) || !room.players.some(p => p.id === targetPlayerId)) {
            return fail("INVALID_REPORT", "Choose another room member and a valid reason.");
        }
        store.prune();
        for (const r of store.reports.values()) {
            if (r.roomId === room.publicRoomId && r.reporter === playerId && r.target === targetPlayerId && !r.decision)
                return fail("DUPLICATE_REPORT", "Your report is already awaiting review.");
        }
        if (store.reports.size >= 5000) return fail("QUEUE_FULL", "The review queue is full.");
        const id = randomUUID();
        store.reports.set(id, { id, roomId: room.publicRoomId, reporter: playerId, target: targetPlayerId, reason, createdAt: Date.now() });
        return { reported: true };
    });
    event("moderation:list", [], () => {
        store.prune();
        return { reports: [...store.reports.values()] };
    }, true);
    event("moderation:review", ["id", "decision"], async ({ id, decision }) => {
        store.prune();
        const report = store.reports.get(id);
        if (!report || report.decision || !["dismiss", "room-ban"].includes(decision)) return fail("INVALID_REVIEW", "Invalid review.");
        const room = rooms.getPlayerRoom(report.target);
        if (decision === "room-ban" && room?.publicRoomId !== report.roomId) return fail("TARGET_UNAVAILABLE", "Player has left the reported room.");
        Object.assign(report, { decision, reviewedAt: Date.now(), reviewer: accountId });
        if (decision === "room-ban") {
            room.banned.add(report.target);
            const target = io.sockets.sockets.get(io.guestIdentityManager.getSocketId(report.target));
            target?.emit("removed-from-room", { roomCode: room.code, reason: "kicked", message: "A moderator removed you from this room." });
            await depart(io, target ?? { data: { playerId: report.target } }, { leaveSocket: true, disconnectGraceManager: grace });
        }
        return { reviewed: true };
    }, true);
}

module.exports = { register, createModeration };
