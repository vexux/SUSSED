const fakeAnswer = require("./games/fake-answer/game");

const games = new Map([[fakeAnswer.id, fakeAnswer]]);

function get(gameId) {
    return games.get(gameId) ?? null;
}

function list() {
    return [...games.values()].map((game) => ({
        id: game.id,
        displayName: game.displayName,
        minPlayers: game.supportedPlayers.min,
        maxPlayers: game.supportedPlayers.max
    }));
}

module.exports = {
    DEFAULT_GAME_ID: fakeAnswer.id,
    get,
    list
};
