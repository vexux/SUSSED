const { randomInt, randomUUID } = require("node:crypto");
const { selectQuestions } = require("./questionBank");

const TOTAL_ROUNDS = 5;
const MAX_COMPLETION_LENGTH = 160;

class FakeAnswerError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "FakeAnswerError";
        this.code = code;
    }
}

function createInitialState(players) {
    return {
        phase: "unstarted",
        currentRound: 0,
        totalRounds: TOTAL_ROUNDS,
        roundId: null,
        participants: players.map(({ id, name }) => ({ id, name })),
        questionOrder: [],
        currentQuestion: null,
        submissions: new Map(),
        submissionStatus: new Map(),
        options: [],
        votes: new Map(),
        scores: new Map(players.map(({ id }) => [id, 0])),
        scoredRounds: new Set(),
        continueReady: new Set(),
        results: null
    };
}

function start(state) {
    let questionOrder;
    try {
        questionOrder = selectQuestions(TOTAL_ROUNDS);
    } catch (error) {
        if (error.code === "QUESTION_POOL_EXHAUSTED") {
            throw new FakeAnswerError(error.code, error.message);
        }
        throw error;
    }
    return {
        ...state,
        phase: "question",
        currentRound: 1,
        roundId: randomUUID(),
        questionOrder,
        currentQuestion: questionOrder[0],
        submissions: new Map(),
        submissionStatus: new Map(state.participants.map(({ id }) => [id, false])),
        options: [],
        votes: new Map(),
        continueReady: new Set(),
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

function openSubmissions(state, expectedRoundId) {
    if (state.phase !== "question") {
        throw new FakeAnswerError(
            "SUBMISSIONS_NOT_OPEN",
            "The answer submission phase cannot be opened now."
        );
    }
    if (expectedRoundId !== undefined && state.roundId !== expectedRoundId) {
        throw new FakeAnswerError(
            "ROUND_MISMATCH",
            "That action belongs to a different round."
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
    const participantById = new Map(
        state.participants.map((player) => [player.id, player])
    );
    const optionById = new Map(state.options.map((option) => [option.id, option]));
    const optionVoters = new Map(state.options.map(({ id }) => [id, []]));
    const correctVotePoints = new Map(
        state.participants.map(({ id }) => [id, 0])
    );
    const bluffPoints = new Map(state.participants.map(({ id }) => [id, 0]));

    for (const [voterId, optionId] of state.votes) {
        const voter = participantById.get(voterId);
        const option = optionById.get(optionId);
        if (!voter || !option || option.authorId === voterId) {
            throw new FakeAnswerError(
                "INVALID_VOTE_STATE",
                "The current round contains an invalid vote mapping."
            );
        }
        optionVoters.get(optionId).push({
            playerId: voter.id,
            name: voter.name
        });
        if (option.correct) {
            correctVotePoints.set(voterId, correctVotePoints.get(voterId) + 1);
        }
        if (option.authorId !== null) {
            if (!participantById.has(option.authorId)) {
                throw new FakeAnswerError(
                    "INVALID_VOTE_STATE",
                    "A voted answer has no participating author."
                );
            }
            bluffPoints.set(option.authorId, bluffPoints.get(option.authorId) + 1);
        }
    }

    const options = state.options.map((option) => ({
        id: option.id,
        completion: option.completion,
        authorId: option.authorId,
        authorName: option.authorId === null
            ? null
            : participantById.get(option.authorId)?.name ?? null,
        isCorrect: option.correct,
        voters: optionVoters.get(option.id)
    }));
    const players = state.participants.map((player) => {
        const voteOptionId = state.votes.get(player.id);
        const voteOption = optionById.get(voteOptionId);
        if (!voteOption) {
            throw new FakeAnswerError(
                "INVALID_VOTE_STATE",
                `Player "${player.id}" has no valid vote for this round.`
            );
        }
        const correctPoints = correctVotePoints.get(player.id);
        const bluffAward = bluffPoints.get(player.id);
        const points = correctPoints + bluffAward;
        const totalScore = state.scores.get(player.id) + points;
        return {
            playerId: player.id,
            name: player.name,
            submittedCompletion: state.submissions.get(player.id),
            voteOptionId,
            voteCompletion: voteOption.completion,
            voteCorrect: voteOption.correct,
            correctVotePoints: correctPoints,
            bluffPoints: bluffAward,
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
    state.continueReady = new Set();
    state.results = results;
    state.phase = "results";
    return { published: true, currentRound: state.currentRound };
}

function continueToNextRound(state, playerId) {
    if (state.phase !== "results") {
        throw new FakeAnswerError(
            "RESULTS_NOT_READY",
            "The current round's results must be available before continuing."
        );
    }
    if (state.currentRound >= state.totalRounds) {
        throw new FakeAnswerError(
            "GAME_FINISHED",
            "The final round is complete."
        );
    }
    if (!state.participants.some((player) => player.id === playerId)) {
        throw new FakeAnswerError(
            "NOT_A_GAME_PLAYER",
            "You are not participating in this game."
        );
    }
    if (state.continueReady.has(playerId)) {
        throw new FakeAnswerError(
            "ALREADY_READY",
            "You are already ready to continue."
        );
    }

    state.continueReady.add(playerId);
    const readyCount = state.continueReady.size;
    if (readyCount < state.participants.length) {
        return {
            ready: true,
            advanced: false,
            readyCount,
            playerCount: state.participants.length
        };
    }

    const nextRound = state.currentRound + 1;
    const nextQuestion = state.questionOrder[nextRound - 1];
    if (!nextQuestion) {
        throw new FakeAnswerError(
            "QUESTION_POOL_EXHAUSTED",
            "No unused question is available for the next round."
        );
    }

    state.currentRound = nextRound;
    state.roundId = randomUUID();
    state.currentQuestion = nextQuestion;
    state.phase = "question";
    state.submissions = new Map();
    state.submissionStatus = new Map(
        state.participants.map(({ id }) => [id, false])
    );
    state.options = [];
    state.votes = new Map();
    state.continueReady = new Set();
    state.results = null;
    return {
        ready: true,
        advanced: true,
        readyCount: 0,
        playerCount: state.participants.length
    };
}

function handleAction(state, action, playerId, payload) {
    switch (action) {
        case "open-submissions":
            return openSubmissions(state, payload?.roundId);
        case "submit-completion":
            return submitCompletion(state, playerId, payload);
        case "begin-voting":
            return beginVoting(state);
        case "vote":
            return vote(state, playerId, payload);
        case "publish-results":
            return publishResults(state);
        case "continue":
            return continueToNextRound(state, playerId);
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
            roundId: state.roundId,
            prompt: {
                id: state.currentQuestion.id,
                text: state.currentQuestion.text
            },
            submissionCount: state.submissions.size,
            playerCount: state.participants.length,
            voteCount: state.votes.size,
            isFinalRound: state.currentRound === state.totalRounds,
            ...(state.currentRound < state.totalRounds
                ? {
                    continueReadyCount: state.continueReady.size,
                    continuePlayerCount: state.participants.length,
                    viewerReadyToContinue: state.continueReady.has(viewerId)
                }
                : {}),
            results: state.results
        };
    }
    return {
        phase: state.phase,
        currentRound: state.currentRound,
        totalRounds: state.totalRounds,
        roundId: state.roundId,
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
                    .map(({ id, completion, authorId }) => ({
                            id,
                            completion,
                            isOwnAnswer: authorId === viewerId
                        }))
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
    isFinished(state) {
        return state.phase === "results" && state.currentRound === state.totalRounds;
    },
    calculateRoundResults,
    MAX_COMPLETION_LENGTH
};
