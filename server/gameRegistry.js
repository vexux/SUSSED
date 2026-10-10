const factOrCap = require("./games/fake-answer/game");
const factOrCapAnime = require("./games/fake-answer/anime");

const games = new Map([
    [factOrCap.id, factOrCap],
    [factOrCapAnime.id, factOrCapAnime]
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
        maxPlayers: game.supportedPlayers.max
    }));
}

module.exports = {
    DEFAULT_GAME_ID: factOrCap.id,
    get,
    list
};
