const { randomInt } = require("node:crypto");
const { questions } = require("./questionBank");

const TOTAL_ROUNDS = 5;
const MAX_COMPLETION_LENGTH = 160;

class FakeAnswerError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "FakeAnswerError";
        this.code = code;
    }
}

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
        currentQuestion: null,
        submissions: new Map(),
        submissionStatus: new Map()
    };
}

function start(state) {
    const questionOrder = shuffledQuestions();
    return {
        ...state,
        phase: "question",
        currentRound: 1,
        questionOrder,
        currentQuestion: questionOrder[0],
        submissions: new Map(),
        submissionStatus: new Map(state.participants.map(({ id }) => [id, false]))
    };
}

function normalizeCompletion(completion) {
    return completion
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function openSubmissions(state) {
    if (state.phase !== "question") {
        throw new FakeAnswerError(
            "SUBMISSIONS_NOT_OPEN",
            "The answer submission phase cannot be opened now."
        );
    }
    state.phase = "answer-submission";
    return { opened: true };
}

function submitCompletion(state, playerId, payload) {
    if (state.phase !== "answer-submission") {
        throw new FakeAnswerError(
            "SUBMISSIONS_NOT_OPEN",
            "Answer submissions are not open."
        );
    }

    const player = state.participants.find((participant) => participant.id === playerId);
    if (!player) {
        throw new FakeAnswerError(
            "NOT_A_GAME_PLAYER",
            "You are not participating in this game."
        );
    }

    if (state.submissionStatus.get(playerId)) {
        throw new FakeAnswerError(
            "ALREADY_SUBMITTED",
            "You have already submitted an answer."
        );
    }

    if (typeof payload !== "string") {
        throw new FakeAnswerError(
            "INVALID_COMPLETION",
            "Enter a completion of up to 160 characters."
        );
    }

    const completion = payload.trim();
    if (
        completion.length === 0 ||
        completion.length > MAX_COMPLETION_LENGTH ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(completion)
    ) {
        throw new FakeAnswerError(
            "INVALID_COMPLETION",
            "Enter a completion of up to 160 characters."
        );
    }

    if (
        normalizeCompletion(completion) ===
        normalizeCompletion(state.currentQuestion.correctCompletion)
    ) {
        throw new FakeAnswerError(
            "CORRECT_COMPLETION_NOT_ALLOWED",
            "Submit an invented completion, not the real one."
        );
    }

    state.submissions.set(playerId, completion);
    state.submissionStatus.set(playerId, true);
    if (state.submissions.size === state.participants.length) {
        state.phase = "reveal";
    }

    return {
        submitted: true,
        submissionCount: state.submissions.size,
        playerCount: state.participants.length
    };
}

function handleAction(state, action, playerId, payload) {
    switch (action) {
        case "open-submissions":
            return openSubmissions(state);
        case "submit-completion":
            return submitCompletion(state, playerId, payload);
        default:
            throw new FakeAnswerError("UNKNOWN_ACTION", "That game action is not available.");
    }
}

function createPublicState(state) {
    return {
        phase: state.phase,
        currentRound: state.currentRound,
        totalRounds: state.totalRounds,
        prompt: state.phase === "reveal"
            ? null
            : {
                id: state.currentQuestion.id,
                text: state.currentQuestion.text
            },
        submissionCount: state.submissions.size,
        playerCount: state.participants.length
    };
}

module.exports = {
    FakeAnswerError,
    id: "fake-answer",
    displayName: "Fake Answer",
    supportedPlayers: Object.freeze({ min: 2, max: 8 }),
    createInitialState,
    start,
    createPublicState,
    handleAction,
    MAX_COMPLETION_LENGTH
};
