const factOrCap = require("./games/fact-or-cap/game");
const factOrCapAnime = require("./games/fact-or-cap/anime");
const bruhWtf = require("./games/bruh-wtf/game");

const games = new Map([
    [factOrCap.id, factOrCap],
    [factOrCapAnime.id, factOrCapAnime],
    [bruhWtf.id, bruhWtf]
]);

function get(gameId) {
    return games.get(gameId) ?? null;
}

function list() {
    return [...games.values()].map((game) => ({
        id: game.id,
        displayName: game.displayName,
        description: game.description,
        minPlayers: game.supportedPlayers.min,
        ...(game.supportedPlayers.max === undefined
            ? {}
            : { maxPlayers: game.supportedPlayers.max })
    }));
}

module.exports = {
    DEFAULT_GAME_ID: factOrCap.id,
    get,
    list
};
