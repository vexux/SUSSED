const assert = require("node:assert/strict");
const test = require("node:test");
const {
    DisconnectGraceManager,
    DISCONNECT_GRACE_PERIOD_MS
} = require("../disconnectGraceManager");
const { FakeScheduler } = require("./fakeScheduler");

function createManager() {
    const scheduler = new FakeScheduler();
    return {
        scheduler,
        manager: new DisconnectGraceManager({
            now: () => scheduler.time,
            setTimeoutFn: scheduler.setTimeout.bind(scheduler),
            clearTimeoutFn: scheduler.clearTimeout.bind(scheduler)
        })
    };
}

test("schedules one exact grace period per player and ignores stale generations", () => {
    const { scheduler, manager } = createManager();
    const expired = [];
    const schedule = (roomInstanceId, onExpire) => manager.schedule({
        playerId: "player-1",
        roomCode: "ROOM",
        roomInstanceId,
        disconnectedAt: scheduler.time,
        onExpire
    });

    const stale = schedule("room-instance-1", () => expired.push("stale"));
    assert.equal(scheduler.pendingCount, 1);
    assert.equal([...scheduler.timers.values()][0].delay, DISCONNECT_GRACE_PERIOD_MS);
    assert.equal(schedule("room-instance-1", () => expired.push("duplicate")), stale);

    manager.cancelPlayer("player-1");
    const current = schedule("room-instance-2", () => expired.push("current"));
    assert.ok(current.generation > stale.generation);
    assert.equal(manager.isCurrent(stale), false);
    assert.equal(manager.isCurrent(current), true);
    stale.timer.callback();
    assert.deepEqual(expired, [], "a late callback from an old generation is ignored");

    scheduler.advanceBy(DISCONNECT_GRACE_PERIOD_MS - 1);
    assert.deepEqual(expired, []);
    scheduler.advanceBy(1);
    assert.deepEqual(expired, ["current"]);
});

test("room cancellation is scoped to the exact room instance", () => {
    const { scheduler, manager } = createManager();
    const expired = [];
    for (const [playerId, roomInstanceId] of [
        ["player-1", "same-code-old-instance"],
        ["player-2", "same-code-new-instance"]
    ]) {
        manager.schedule({
            playerId,
            roomCode: "ROOM",
            roomInstanceId,
            disconnectedAt: scheduler.time,
            onExpire: (entry) => {
                expired.push(playerId);
                manager.finish(entry);
            }
        });
    }

    assert.equal(manager.cancelRoom("ROOM", "same-code-old-instance"), 1);
    assert.equal(manager.size, 1);
    scheduler.advanceBy(DISCONNECT_GRACE_PERIOD_MS);
    assert.deepEqual(expired, ["player-2"]);
    assert.equal(manager.size, 0, "expiry callbacks finish their own entry");
});

test("finishes and cancels all remaining timers", () => {
    const { scheduler, manager } = createManager();
    const entry = manager.schedule({
        playerId: "player-1",
        roomCode: "ROOM",
        roomInstanceId: "instance",
        disconnectedAt: scheduler.time,
        onExpire() {}
    });

    assert.equal(manager.finish(entry), true);
    assert.equal(manager.finish(entry), false);
    assert.equal(manager.size, 0);
    assert.equal(scheduler.pendingCount, 0);
    manager.cancelAll();
});
