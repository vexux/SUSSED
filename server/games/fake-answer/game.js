const { randomInt } = require("node:crypto");
const { questions } = require("./questionBank");

const TOTAL_ROUNDS = 5;

function shuffledQuestions() {
    const shuffled = [...questions];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = randomInt(index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled.slice(0, TOTAL_ROUNDS);
}

function createInitialState(players) {
    return {
        phase: "unstarted",
        currentRound: 0,
        totalRounds: TOTAL_ROUNDS,
        participants: players.map(({ id, name }) => ({ id, name })),
        questionOrder: [],
        currentQuestion: null
    };
}

function start(state) {
    const questionOrder = shuffledQuestions();
    return {
        ...state,
        phase: "question",
        currentRound: 1,
        questionOrder,
        currentQuestion: questionOrder[0]
    };
}

function createPublicState(state) {
    return {
        phase: state.phase,
        currentRound: state.currentRound,
        totalRounds: state.totalRounds,
        question: {
            id: state.currentQuestion.id,
            text: state.currentQuestion.text
        }
    };
}

module.exports = {
    id: "fake-answer",
    displayName: "Fake Answer",
    supportedPlayers: Object.freeze({ min: 4, max: 4 }),
    createInitialState,
    start,
    createPublicState
};
