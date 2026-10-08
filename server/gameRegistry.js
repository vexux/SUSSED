const fakeAnswer = require("./games/fake-answer/game");

const games = new Map([[fakeAnswer.id, fakeAnswer]]);

function get(gameId) {
    return games.get(gameId) ?? null;
}

module.exports = { get };
