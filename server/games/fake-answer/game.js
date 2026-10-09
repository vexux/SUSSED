const { randomInt, randomUUID } = require("node:crypto");
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
        submissionStatus: new Map(),
        options: [],
        votes: new Map()
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
        submissionStatus: new Map(state.participants.map(({ id }) => [id, false])),
        options: [],
        votes: new Map()
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
        state.options = shuffleOptions([
            ...Array.from(state.submissions, ([authorId, answer]) => ({
                id: randomUUID(),
                completion: answer,
                authorId,
                correct: false
            })),
            {
                id: randomUUID(),
                completion: state.currentQuestion.correctCompletion,
                authorId: null,
                correct: true
            }
        ]);
        state.phase = "reveal";
    }

    return {
        submitted: true,
        submissionCount: state.submissions.size,
        playerCount: state.participants.length
    };
}

function shuffleOptions(options) {
    for (let index = options.length - 1; index > 0; index -= 1) {
        const swapIndex = randomInt(index + 1);
        [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
    }
    return options;
}

function beginVoting(state) {
    if (state.phase !== "reveal" || state.options.length === 0) {
        throw new FakeAnswerError(
            "REVEAL_NOT_READY",
            "Answer reveal is not ready for voting."
        );
    }
    if (
        state.participants.some(
            (player) => !state.options.some((option) => option.authorId !== player.id)
        )
    ) {
        throw new FakeAnswerError(
            "NO_ELIGIBLE_OPTIONS",
            "Every player must have at least one answer they are allowed to vote for."
        );
    }
    state.phase = "voting";
    return { opened: true };
}

function vote(state, playerId, optionId) {
    if (state.phase !== "voting") {
        throw new FakeAnswerError("VOTING_NOT_OPEN", "Voting is not open.");
    }

    const player = state.participants.find((participant) => participant.id === playerId);
    if (!player) {
        throw new FakeAnswerError(
            "NOT_A_GAME_PLAYER",
            "You are not participating in this game."
        );
    }
    if (state.votes.has(playerId)) {
        throw new FakeAnswerError("ALREADY_VOTED", "You have already voted.");
    }

    const option = state.options.find((entry) => entry.id === optionId);
    if (!option) {
        throw new FakeAnswerError("INVALID_OPTION", "That answer option is not available.");
    }
    if (option.authorId === playerId) {
        throw new FakeAnswerError(
            "OWN_ANSWER_NOT_ALLOWED",
            "You cannot vote for your own completion."
        );
    }

    state.votes.set(playerId, optionId);
    if (state.votes.size === state.participants.length) {
        state.phase = "waiting-for-results";
    }

    return {
        voted: true,
        voteCount: state.votes.size,
        playerCount: state.participants.length
    };
}

function handleAction(state, action, playerId, payload) {
    switch (action) {
        case "open-submissions":
            return openSubmissions(state);
        case "submit-completion":
            return submitCompletion(state, playerId, payload);
        case "begin-voting":
            return beginVoting(state);
        case "vote":
            return vote(state, playerId, payload);
        default:
            throw new FakeAnswerError("UNKNOWN_ACTION", "That game action is not available.");
    }
}

function createPublicState(state, viewerId) {
    const includesVoteOptions = state.phase === "reveal" || state.phase === "voting";
    return {
        phase: state.phase,
        currentRound: state.currentRound,
        totalRounds: state.totalRounds,
        prompt: state.phase === "waiting-for-results"
            ? null
            : {
                id: state.currentQuestion.id,
                text: state.currentQuestion.text
            },
        submissionCount: state.submissions.size,
        playerCount: state.participants.length,
        ...(includesVoteOptions
            ? {
                options: state.options
                    .filter((option) => option.authorId !== viewerId)
                    .map(({ id, completion }) => ({ id, completion }))
            }
            : {}),
        ...(state.phase === "voting" || state.phase === "waiting-for-results"
            ? { voteCount: state.votes.size }
            : {})
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
