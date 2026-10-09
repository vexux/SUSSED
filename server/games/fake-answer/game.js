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
        votes: new Map(),
        scores: new Map(players.map(({ id }) => [id, 0])),
        scoredRounds: new Set(),
        results: null
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
        votes: new Map(),
        results: null
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

function calculateRoundResults(state) {
    const roundPoints = new Map(state.participants.map(({ id }) => [id, 0]));
    const options = state.options.map((option) => ({
        id: option.id,
        completion: option.completion,
        authorId: option.authorId,
        authorName: option.authorId === null
            ? null
            : state.participants.find(({ id }) => id === option.authorId).name,
        isCorrect: option.correct
    }));

    for (const [voterId, optionId] of state.votes) {
        const option = state.options.find(({ id }) => id === optionId);
        if (option.correct) {
            roundPoints.set(voterId, roundPoints.get(voterId) + 1);
        }
        if (option.authorId !== null && option.authorId !== voterId) {
            roundPoints.set(option.authorId, roundPoints.get(option.authorId) + 1);
        }
    }

    const players = state.participants.map((player) => {
        const voteOptionId = state.votes.get(player.id);
        const voteOption = state.options.find(({ id }) => id === voteOptionId);
        const points = roundPoints.get(player.id);
        const totalScore = state.scores.get(player.id) + points;
        return {
            playerId: player.id,
            name: player.name,
            submittedCompletion: state.submissions.get(player.id),
            voteOptionId,
            voteCompletion: voteOption.completion,
            voteCorrect: voteOption.correct,
            roundPoints: points,
            totalScore
        };
    });
    const sortedScores = [...players].sort((first, second) =>
        second.totalScore - first.totalScore ||
        state.participants.findIndex(({ id }) => id === first.playerId) -
            state.participants.findIndex(({ id }) => id === second.playerId)
    );
    let currentRank = 0;
    let previousScore = null;
    const standings = sortedScores.map((player, index) => {
        if (index === 0 || player.totalScore !== previousScore) {
            currentRank = index + 1;
        }
        previousScore = player.totalScore;
        return {
            playerId: player.playerId,
            name: player.name,
            totalScore: player.totalScore,
            rank: currentRank
        };
    });

    return {
        correctCompletion: state.currentQuestion.correctCompletion,
        options,
        players,
        standings
    };
}

function publishResults(state) {
    if (state.phase !== "waiting-for-results") {
        throw new FakeAnswerError(
            state.phase === "results" ? "RESULTS_ALREADY_PUBLISHED" : "VOTES_NOT_COMPLETE",
            state.phase === "results"
                ? "Results for this round have already been published."
                : "Results are not ready until all players have voted."
        );
    }
    if (state.scoredRounds.has(state.currentRound)) {
        throw new FakeAnswerError(
            "RESULTS_ALREADY_PUBLISHED",
            "Results for this round have already been published."
        );
    }

    const results = calculateRoundResults(state);
    for (const player of state.participants) {
        state.scores.set(player.id, results.players.find(
            ({ playerId }) => playerId === player.id
        ).totalScore);
    }
    state.scoredRounds.add(state.currentRound);
    state.results = results;
    state.phase = "results";
    return { published: true, currentRound: state.currentRound };
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
        case "publish-results":
            return publishResults(state);
        default:
            throw new FakeAnswerError("UNKNOWN_ACTION", "That game action is not available.");
    }
}

function createPublicState(state, viewerId) {
    const includesVoteOptions = state.phase === "reveal" || state.phase === "voting";
    if (state.phase === "results") {
        return {
            phase: state.phase,
            currentRound: state.currentRound,
            totalRounds: state.totalRounds,
            prompt: {
                id: state.currentQuestion.id,
                text: state.currentQuestion.text
            },
            submissionCount: state.submissions.size,
            playerCount: state.participants.length,
            voteCount: state.votes.size,
            results: state.results
        };
    }
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
    calculateRoundResults,
    MAX_COMPLETION_LENGTH
};
