const factOrCap = require("./games/fact-or-cap/game");
const factOrCapAnime = require("./games/fact-or-cap/anime");
const bruhWtf = require("./games/bruh-wtf/game");
const { MAX_ROOM_CAPACITY } = require("./roomConfiguration");

const games = new Map();
const requiredHooks = [
    "createInitialState", "start", "handleAction", "createPublicState", "isFinished",
    "removeParticipant", "setPlayerConnectionStatus", "isParticipantEligible"
];

function register(game) {
    if (typeof game?.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(game.id)) {
        throw new TypeError("A game ID must be a lowercase slug.");
    }
    if (games.has(game.id)) throw new Error(`Duplicate game ID: ${game.id}`);
    for (const key of ["displayName", "description", "category", "socketProtocol"]) {
        if (typeof game[key] !== "string" || !game[key].trim()) throw new TypeError(`Invalid game ${key}`);
    }
    const { min, max = MAX_ROOM_CAPACITY } = game.supportedPlayers ?? {};
    if (!Number.isInteger(min) || min < 2 || !Number.isInteger(max) || max < min || min > MAX_ROOM_CAPACITY) {
        throw new TypeError("Invalid supported player range.");
    }
    if (typeof game.supportsRoundSelection !== "boolean") throw new TypeError("Invalid round selection setting.");
    for (const key of requiredHooks) {
        if (typeof game[key] !== "function") throw new TypeError(`Missing game hook: ${key}`);
    }
    games.set(game.id, game);
}

for (const game of [factOrCap, factOrCapAnime, bruhWtf]) register(game);

function get(gameId) {
    return games.get(gameId) ?? null;
}

function list() {
    return [...games.values()].map((game) => ({
        id: game.id,
        displayName: game.displayName,
        description: game.description,
        category: game.category,
        minPlayers: game.supportedPlayers.min,
        maxPlayers: Math.min(MAX_ROOM_CAPACITY, game.supportedPlayers.max ?? MAX_ROOM_CAPACITY)
    }));
}

module.exports = {
    DEFAULT_GAME_ID: factOrCap.id,
    register,
    get,
    list
};
