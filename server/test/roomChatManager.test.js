const assert = require("node:assert/strict");
const test = require("node:test");
const { createRoomChatManager } = require("../roomChatManager");

function createClock() {
    let time = Date.parse("2026-11-20T10:00:00.000Z");
    return { now: () => time, advance: (milliseconds) => { time += milliseconds; } };
}

test("room chat stores server timestamps, snapshots names, and supports plain text and emoji", () => {
    const clock = createClock();
    let id = 0;
    const chat = createRoomChatManager({ now: clock.now, createId: () => `message-${++id}` });
    const first = chat.addPlayerMessage("room-a", "player-a", "Alex", "  Hello 🙂  ");
    const system = chat.addSystemMessage("room-a", "Alex joined the room.");
    assert.deepEqual(first, {
        id: "message-1", type: "player", senderName: "Alex", text: "Hello 🙂",
        createdAt: "2026-11-20T10:00:00.000Z",
    });
    assert.deepEqual(system, {
        id: "message-2", type: "system", senderName: null, text: "Alex joined the room.",
        createdAt: "2026-11-20T10:00:00.000Z",
    });
    assert.notEqual(first.id, system.id);
});

test("room chat rejects invalid, empty, and oversized text and rate limits by identity", () => {
    const clock = createClock();
    let id = 0;
    const chat = createRoomChatManager({ now: clock.now, createId: () => `message-${++id}` });
    assert.throws(() => chat.addPlayerMessage("room-a", "player-a", "Alex", null), { code: "INVALID_REQUEST" });
    assert.throws(() => chat.addPlayerMessage("room-a", "player-a", "Alex", " \n "), { code: "INVALID_REQUEST" });
    assert.throws(() => chat.addPlayerMessage("room-a", "player-a", "Alex", "x".repeat(201)), { code: "INVALID_REQUEST" });
    for (const text of ["x".repeat(200) + " ", "x\u0000y"]) {
        assert.throws(() => chat.addPlayerMessage("room-a", "player-a", "Alex", text), { code: "INVALID_REQUEST" });
    }
    chat.addPlayerMessage("room-a", "player-a", "Alex", "x".repeat(200));
    for (let index = 0; index < 4; index += 1) {
        chat.addPlayerMessage("room-a", "player-a", "Alex", `message ${index}`);
    }
    assert.throws(() => chat.addPlayerMessage("room-a", "player-a", "Alex", "sixth"), { code: "CHAT_RATE_LIMITED" });
    // Rate state belongs to the player identity, so using a new socket changes nothing.
    assert.throws(() => chat.addPlayerMessage("room-b", "player-a", "Alex", "new connection"), { code: "CHAT_RATE_LIMITED" });
    chat.clearRoom("room-a");
    clock.advance(9999);
    assert.throws(() => chat.addPlayerMessage("room-b", "player-a", "Alex", "still limited"), { code: "CHAT_RATE_LIMITED" });
    clock.advance(1);
    assert.equal(chat.addPlayerMessage("room-a", "player-a", "Alex", "after window").text, "after window");
});

test("cursor history returns latest and older pages in stable chronological order without duplicates", () => {
    const clock = createClock();
    let id = 0;
    const chat = createRoomChatManager({ now: clock.now, createId: () => `message-${String(++id).padStart(3, "0")}` });
    for (let index = 0; index < 120; index += 1) {
        chat.addSystemMessage("room-a", `system ${index}`);
        // All messages share a timestamp to exercise ID ordering across page boundaries.
    }
    const latest = chat.getHistory("room-a", { before: null, limit: 500 });
    assert.equal(latest.messages.length, 50);
    assert.equal(latest.messages[0].text, "system 70");
    assert.equal(latest.messages.at(-1).text, "system 119");
    assert.equal(latest.hasMore, true);
    const older = chat.getHistory("room-a", { before: latest.cursor, limit: 50 });
    assert.equal(older.messages.length, 50);
    assert.equal(older.messages[0].text, "system 20");
    assert.equal(older.messages.at(-1).text, "system 69");
    assert.equal(older.hasMore, true);
    const oldest = chat.getHistory("room-a", { before: older.cursor, limit: 50 });
    assert.equal(oldest.messages.length, 20);
    assert.equal(oldest.messages.at(-1).text, "system 19");
    assert.equal(oldest.hasMore, false);

    chat.addSystemMessage("room-a", "new live message");
    const nextOlder = chat.getHistory("room-a", { before: latest.cursor, limit: 50 });
    assert.deepEqual(nextOlder.messages, older.messages);
    assert.equal(new Set([...latest.messages, ...older.messages, ...oldest.messages].map(({ id: messageId }) => messageId)).size, 120);
});

test("chat history is isolated by logical room and cleared with room destruction", () => {
    const chat = createRoomChatManager();
    chat.addSystemMessage("room-instance-a", "A");
    chat.addSystemMessage("room-instance-b", "B");
    assert.equal(chat.getHistory("room-instance-a").messages[0].text, "A");
    assert.equal(chat.getHistory("room-instance-b").messages[0].text, "B");
    assert.equal(chat.getMessageCount("room-instance-a"), 1);
    assert.equal(chat.clearRoom("room-instance-a"), true);
    assert.equal(chat.getHistory("room-instance-a").messages.length, 0);
    assert.equal(chat.getHistory("room-instance-b").messages.length, 1);
});
