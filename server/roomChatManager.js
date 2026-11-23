const { randomUUID } = require("node:crypto");

const MAX_MESSAGE_LENGTH = 200;
const MAX_MESSAGES_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_PAGE_SIZE = 50;

class RoomChatError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "RoomChatError";
        this.code = code;
    }
}

function normalizeMessageText(text) {
    if (typeof text !== "string") {
        throw new RoomChatError("INVALID_REQUEST", "Message text must be a string.");
    }
    const normalized = text.trim();
    if (!normalized) {
        throw new RoomChatError("INVALID_REQUEST", "Enter a message before sending.");
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
        throw new RoomChatError("INVALID_REQUEST", `Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`);
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
        throw new RoomChatError("INVALID_REQUEST", "Remove control characters from the message.");
    }
    return normalized;
}

function createRoomChatManager({ now = Date.now, createId = randomUUID } = {}) {
    let nextSweep = -Infinity;
    const histories = new Map();
    const rateLimits = new Map();
    const receipts = new Map();

    function makeMessage(roomId, type, senderName, text) {
        if (typeof roomId !== "string" || roomId.length === 0) {
            throw new TypeError("A logical room identity is required.");
        }
        let history = histories.get(roomId);
        if (!history) {
            history = [];
            histories.set(roomId, history);
        }
        const message = {
            id: createId(),
            type,
            senderName,
            text,
            createdAt: new Date(now()).toISOString(),
        };
        const insertAt = history.findIndex((entry) =>
            entry.createdAt > message.createdAt ||
            (entry.createdAt === message.createdAt && entry.id > message.id)
        );
        if (insertAt < 0) history.push(message);
        else history.splice(insertAt, 0, message);
        return { ...message };
    }

    function addPlayerMessage(roomId, playerId, senderName, text) {
        if (typeof playerId !== "string" || !playerId || typeof senderName !== "string" || !senderName.trim()) {
            throw new RoomChatError("INVALID_REQUEST", "A valid room member is required.");
        }
        const normalized = normalizeMessageText(text);
        const time = now();
        if (time >= nextSweep) {
            for (const [id, timestamps] of rateLimits) {
                if (timestamps.every((sentAt) => time - sentAt >= RATE_LIMIT_WINDOW_MS)) rateLimits.delete(id);
            }
            nextSweep = time + RATE_LIMIT_WINDOW_MS;
        }
        const recent = (rateLimits.get(playerId) ?? []).filter((sentAt) => time - sentAt < RATE_LIMIT_WINDOW_MS);
        if (recent.length >= MAX_MESSAGES_PER_WINDOW) {
            rateLimits.set(playerId, recent);
            throw new RoomChatError("CHAT_RATE_LIMITED", "You can send up to 5 messages every 10 seconds.");
        }
        recent.push(time);
        rateLimits.set(playerId, recent);
        return makeMessage(roomId, "player", senderName.trim(), normalized);
    }

    function send(roomId, playerId, senderName, text, requestId) {
        const key = playerId + ":" + requestId;
        const previous = requestId && receipts.get(roomId)?.get(key);
        if (previous) {
            if (normalizeMessageText(text) !== previous.text) throw new RoomChatError("INVALID_REQUEST", "This send request was already used.");
            return { message: previous, duplicate: true };
        }
        const message = addPlayerMessage(roomId, playerId, senderName, text);
        if (requestId) {
            if (!receipts.has(roomId)) receipts.set(roomId, new Map());
            receipts.get(roomId).set(key, message);
        }
        return { message, duplicate: false };
    }

    function addSystemMessage(roomId, text) {
        const normalized = normalizeMessageText(text);
        return makeMessage(roomId, "system", null, normalized);
    }

    function getHistory(roomId, { before = null, limit = MAX_PAGE_SIZE } = {}) {
        if (typeof roomId !== "string" || roomId.length === 0) {
            throw new TypeError("A logical room identity is required.");
        }
        if (before !== null && typeof before !== "string") {
            throw new RoomChatError("INVALID_REQUEST", "The history cursor is invalid.");
        }
        if (!Number.isInteger(limit) || limit < 1) {
            throw new RoomChatError("INVALID_REQUEST", "The history page size must be a positive integer.");
        }
        const pageSize = Math.min(MAX_PAGE_SIZE, limit);
        const history = histories.get(roomId) ?? [];
        let end = history.length;
        if (before !== null) {
            const cursorIndex = history.findIndex(({ id }) => id === before);
            if (cursorIndex < 0) {
                throw new RoomChatError("INVALID_REQUEST", "The history cursor is no longer valid.");
            }
            end = cursorIndex;
        }
        const start = Math.max(0, end - pageSize);
        const messages = history.slice(start, end).map((message) => ({ ...message }));
        return {
            messages,
            cursor: messages[0]?.id ?? null,
            hasMore: start > 0,
            before,
            totalCount: history.length,
        };
    }

    function clearRoom(roomId) {
        receipts.delete(roomId);
        return histories.delete(roomId);
    }

    function getMessageCount(roomId) {
        return histories.get(roomId)?.length ?? 0;
    }

    return { send, addPlayerMessage, addSystemMessage, getHistory, clearRoom, getMessageCount };
}

module.exports = {
    MAX_MESSAGE_LENGTH,
    MAX_MESSAGES_PER_WINDOW,
    RATE_LIMIT_WINDOW_MS,
    MAX_PAGE_SIZE,
    RoomChatError,
    createRoomChatManager,
};
