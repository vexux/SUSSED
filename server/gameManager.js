const { randomInt } = require("node:crypto");
const { questions } = require("./questionBank");

const TOTAL_ROUNDS = 5;
const games = new Map();

const GAME_PHASES = Object.freeze([
    "question",
    "answer-submission",
    "reveal",
    "voting",
    "results",
    "finished"
]);

function shuffle(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = randomInt(index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

function startGame(room) {
    if (!room || room.status !== "starting") {
        throw new Error("A room must be starting before its game can be initialized.");
    }
    if (games.has(room.code)) {
        throw new Error("A game has already been initialized for this room.");
    }
    if (questions.length < TOTAL_ROUNDS) {
        throw new Error(`The question bank must contain at least ${TOTAL_ROUNDS} questions.`);
    }

    const questionOrder = shuffle(questions).slice(0, TOTAL_ROUNDS);
    const game = {
        roomCode: room.code,
        phase: "question",
        currentRound: 1,
        totalRounds: TOTAL_ROUNDS,
        currentQuestion: questionOrder[0],
        questionOrder,
        players: room.players.map(({ id, name }) => ({ id, name }))
    };
    games.set(room.code, game);
    return game;
}

function createPublicGameState(game) {
    return {
        roomCode: game.roomCode,
        phase: game.phase,
        currentRound: game.currentRound,
        totalRounds: game.totalRounds,
        question: {
            id: game.currentQuestion.id,
            text: game.currentQuestion.text
        }
    };
}

function getGame(roomCode) {
    return games.get(roomCode) ?? null;
}

function removeGame(roomCode) {
    return games.delete(roomCode);
}

module.exports = {
    GAME_PHASES,
    TOTAL_ROUNDS,
    createPublicGameState,
    getGame,
    removeGame,
    startGame
};
