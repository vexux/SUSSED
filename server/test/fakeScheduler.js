class FakeScheduler {
    constructor(startTime = 1_000_000) {
        this.time = startTime;
        this.nextId = 1;
        this.timers = new Map();
    }

    setTimeout(callback, delay) {
        const timer = {
            id: this.nextId++,
            callback,
            delay,
            dueAt: this.time + delay,
            cancelled: false
        };
        this.timers.set(timer.id, timer);
        return timer;
    }

    clearTimeout(timer) {
        timer.cancelled = true;
        this.timers.delete(timer.id);
    }

    advanceBy(milliseconds) {
        const target = this.time + milliseconds;
        while (true) {
            const next = [...this.timers.values()]
                .filter(({ dueAt }) => dueAt <= target)
                .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
            if (!next) break;
            this.timers.delete(next.id);
            this.time = next.dueAt;
            if (!next.cancelled) next.callback();
        }
        this.time = target;
    }

    get pendingCount() {
        return this.timers.size;
    }
}

module.exports = { FakeScheduler };
