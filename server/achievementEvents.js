const ACHIEVEMENT_EVENT_TYPES = Object.freeze({
    GAME_STARTED: "game.started",
    ROUND_COMPLETED: "game.round-completed",
    GAME_COMPLETED: "game.completed"
});

/**
 * Internal server-side lifecycle contract. It deliberately carries no client
 * identity or score data; consumers must resolve authoritative participants.
 *
 * @typedef {"game.started" | "game.round-completed" | "game.completed"} AchievementEventType
 * @typedef {{
 *   type: AchievementEventType,
 *   roomCode: string,
 *   sessionId: string,
 *   gameId: string,
 *   occurredAt: string,
 *   round?: number
 * }} AchievementEvent
 */

/**
 * @param {AchievementEventType} type
 * @param {{roomCode: string, sessionId: string, gameId: string, occurredAt?: string, round?: number}} details
 * @returns {AchievementEvent}
 */
function createAchievementEvent(type, details) {
    if (!Object.values(ACHIEVEMENT_EVENT_TYPES).includes(type)) {
        throw new TypeError("Unsupported achievement event type.");
    }
    if (!details || typeof details !== "object") {
        throw new TypeError("Achievement event details are required.");
    }
    for (const field of ["roomCode", "sessionId", "gameId"]) {
        if (typeof details[field] !== "string" || details[field].length === 0) {
            throw new TypeError(`Achievement event ${field} is required.`);
        }
    }
    if (type === ACHIEVEMENT_EVENT_TYPES.ROUND_COMPLETED &&
        (!Number.isInteger(details.round) || details.round < 1)) {
        throw new TypeError("Round-completed events require a positive round number.");
    }
    if (type !== ACHIEVEMENT_EVENT_TYPES.ROUND_COMPLETED && details.round !== undefined) {
        throw new TypeError("Only round-completed events may include a round number.");
    }
    const occurredAt = details.occurredAt ?? new Date().toISOString();
    if (typeof occurredAt !== "string" || Number.isNaN(Date.parse(occurredAt))) {
        throw new TypeError("Achievement event timestamp must be a valid date.");
    }
    return Object.freeze({
        type,
        roomCode: details.roomCode,
        sessionId: details.sessionId,
        gameId: details.gameId,
        occurredAt,
        ...(type === ACHIEVEMENT_EVENT_TYPES.ROUND_COMPLETED ? { round: details.round } : {})
    });
}

module.exports = { ACHIEVEMENT_EVENT_TYPES, createAchievementEvent };
