const { randomInt, randomUUID } = require("node:crypto");
const questionBank = require("./questionBank");

const {
    DEFAULT_ROUND_COUNT,
    isSupportedRoundCount
} = require("../../roundConfiguration");
const MAX_COMPLETION_LENGTH = 160;

class FakeAnswerError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "FakeAnswerError";
        this.code = code;
    }
}

function createInitialState(players, { roundCount = DEFAULT_ROUND_COUNT } = {}) {
    if (!isSupportedRoundCount(roundCount)) {
        throw new FakeAnswerError("INVALID_ROUND_COUNT", "Choose 5, 7, or 10 rounds.");
    }
    return {
        phase: "unstarted",
        currentRound: 0,
        totalRounds: roundCount,
        roundId: null,
        participants: players.map(({ id, name }) => ({ id, name })),
        // Keep the round roster separate from the active roster. Departures
        // affect future participation, not already-recorded round actions.
        roundParticipants: players.map(({ id, name }) => ({ id, name })),
        connectedPlayerIds: new Set(players.map(({ id }) => id)),
        roundEligiblePlayerIds: new Set(players.map(({ id }) => id)),
        playerRecords: new Map(players.map(({ id, name }) => [id, { id, name }])),
        questionOrder: [],
        currentQuestion: null,
        submissions: new Map(),
        submissionStatus: new Map(),
        options: [],
        votes: new Map(),
        scores: new Map(players.map(({ id }) => [id, 0])),
        statistics: new Map(players.map(({ id }) => [id, {
            fakeVotesReceived: 0,
            fakeVotesCast: 0,
            correctVotes: 0
        }])),
        scoredRounds: new Set(),
        continueReady: new Set(),
        roundHistory: [],
        results: null
    };
}

function start(state, selectQuestions) {
    let questionOrder;
    try {
        questionOrder = selectQuestions(state.totalRounds);
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
        roundParticipants: state.participants.map(({ id, name }) => ({ id, name })),
        roundEligiblePlayerIds: new Set(state.connectedPlayerIds),
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
        .toLowerCase()
        .replace(/\s+/gu, " ")
        .trim();
}

function allActiveParticipantsSubmitted(state) {
    return state.roundParticipants.every(({ id }) =>
        !state.roundEligiblePlayerIds.has(id) || state.submissionStatus.get(id) === true
    );
}

function allActiveParticipantsVoted(state) {
    return state.roundParticipants.every(({ id }) =>
        !state.roundEligiblePlayerIds.has(id) || state.votes.has(id)
    );
}

function getRequiredPlayers(state, completed) {
    return state.participants.filter(({ id }) =>
        state.roundEligiblePlayerIds.has(id) || completed(id)
    );
}

function getRequiredContinuePlayers(state) {
    return getRequiredPlayers(state, (id) => state.continueReady.has(id));
}

function advanceToNextRound(state) {
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
    state.roundParticipants = state.participants.map(({ id, name }) => ({ id, name }));
    state.roundEligiblePlayerIds = new Set(
        state.roundParticipants
            .filter(({ id }) => state.connectedPlayerIds.has(id))
            .map(({ id }) => id)
    );
    state.phase = "question";
    state.submissions = new Map();
    state.submissionStatus = new Map(
        state.participants.map(({ id }) => [id, false])
    );
    state.options = [];
    state.votes = new Map();
    state.continueReady = new Set();
    state.results = null;
}

function createVotingOptions(state) {
    state.options = shuffleOptions([
        ...Array.from(state.submissions, ([authorId, completion]) => ({
            id: randomUUID(), completion, authorId, correct: false
        })),
        {
            id: randomUUID(),
            completion: state.currentQuestion.correctCompletion,
            authorId: null,
            correct: true
        }
    ]);
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
    if (allActiveParticipantsSubmitted(state)) {
        createVotingOptions(state);
        state.phase = "reveal";
        beginVoting(state);
        if (allActiveParticipantsVoted(state)) {
            state.phase = "waiting-for-results";
            publishResults(state);
        }
    }
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
    if (!state.roundEligiblePlayerIds.has(playerId)) {
        throw new FakeAnswerError(
            "SPECTATOR",
            "You are spectating this round and cannot submit an answer."
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

    const normalizedCompletion = normalizeCompletion(completion);
    if (
        normalizedCompletion === normalizeCompletion(state.currentQuestion.correctCompletion) ||
        [...state.submissions.values()].some(
            (submitted) => normalizeCompletion(submitted) === normalizedCompletion
        )
    ) {
        throw new FakeAnswerError(
            "DUPLICATE_ANSWER",
            "Duplicate answer. Please submit a different completion."
        );
    }

    state.submissions.set(playerId, completion);
    state.submissionStatus.set(playerId, true);
    if (allActiveParticipantsSubmitted(state)) {
        createVotingOptions(state);
        state.phase = "reveal";
    }

    const requiredPlayers = getRequiredPlayers(
        state,
        (id) => state.submissionStatus.get(id) === true
    );
    return {
        submitted: true,
        submissionCount: requiredPlayers.filter(({ id }) => state.submissionStatus.get(id) === true).length,
        playerCount: requiredPlayers.length
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
        [...state.roundEligiblePlayerIds].some(
            (playerId) => !state.options.some((option) => option.authorId !== playerId)
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
    if (!state.roundEligiblePlayerIds.has(playerId)) {
        throw new FakeAnswerError(
            "SPECTATOR",
            "You are spectating this round and cannot vote."
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
    if (allActiveParticipantsVoted(state)) {
        state.phase = "waiting-for-results";
    }

    const requiredPlayers = getRequiredPlayers(state, (id) => state.votes.has(id));
    return {
        voted: true,
        voteCount: requiredPlayers.filter(({ id }) => state.votes.has(id)).length,
        playerCount: requiredPlayers.length
    };
}

function calculateRoundResults(state) {
    const roundParticipants = state.roundParticipants ?? state.participants;
    const participantById = new Map(
        roundParticipants.map((player) => [player.id, player])
    );
    const optionById = new Map(state.options.map((option) => [option.id, option]));
    const optionVoters = new Map(state.options.map(({ id }) => [id, []]));
    const correctVotePoints = new Map(
        roundParticipants.map(({ id }) => [id, 0])
    );
    const bluffPoints = new Map(roundParticipants.map(({ id }) => [id, 0]));

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
            correctVotePoints.set(voterId, correctVotePoints.get(voterId) + 2);
        }
        if (option.authorId !== null) {
            if (!participantById.has(option.authorId)) {
                throw new FakeAnswerError(
                    "INVALID_VOTE_STATE",
                    "A voted answer has no current-round author."
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
    const players = roundParticipants.map((player) => {
        const voteOptionId = state.votes.get(player.id);
        const voteOption = optionById.get(voteOptionId);
        if (voteOptionId && !voteOption) {
            throw new FakeAnswerError(
                "INVALID_VOTE_STATE",
                `Player "${player.id}" has no valid vote for this round.`
            );
        }
        const correctPoints = correctVotePoints.get(player.id) ?? 0;
        const bluffAward = bluffPoints.get(player.id) ?? 0;
        const points = correctPoints + bluffAward;
        const totalScore = (state.scores.get(player.id) ?? 0) + points;
        return {
            playerId: player.id,
            name: player.name,
            submittedCompletion: state.submissions.get(player.id) ?? null,
            voteOptionId: voteOptionId ?? null,
            voteCompletion: voteOption?.completion ?? null,
            voteCorrect: voteOption?.correct ?? null,
            correctVotePoints: correctPoints,
            bluffPoints: bluffAward,
            roundPoints: points,
            totalScore
        };
    });
    const roundPointsByPlayer = new Map(players.map(({ playerId, roundPoints }) => [playerId, roundPoints]));
    const sortedScores = [...state.playerRecords.values()].map(({ id, name }) => ({
        playerId: id,
        name,
        totalScore: (state.scores.get(id) ?? 0) + (roundPointsByPlayer.get(id) ?? 0)
    })).sort((first, second) =>
        second.totalScore - first.totalScore ||
        (first.playerId < second.playerId ? -1 : first.playerId > second.playerId ? 1 : 0)
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
        roundPlayerCount: roundParticipants.length,
        standings
    };
}

function createFinalStatistics(state) {
    const statisticLeaders = (statistic) => {
        const counts = [...state.statistics.entries()];
        const maximum = Math.max(0, ...counts.map(([, values]) => values[statistic]));
        return {
            playerIds: maximum === 0
                ? []
                : counts
                    .filter(([, values]) => values[statistic] === maximum)
                    .map(([playerId]) => playerId)
                    .sort(),
            count: maximum
        };
    };
    return {
        mostPlayersFooled: statisticLeaders("fakeVotesReceived"),
        gotFooledMost: statisticLeaders("fakeVotesCast"),
        mostCorrectAnswers: statisticLeaders("correctVotes")
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
    const optionsById = new Map(results.options.map((option) => [option.id, option]));
    for (const option of results.options) {
        if (option.isCorrect || option.authorId === null) {
            continue;
        }
        const authorStats = state.statistics.get(option.authorId);
        if (!authorStats) {
            throw new FakeAnswerError(
                "INVALID_VOTE_STATE",
                "A bluff answer has no participating author."
            );
        }
        authorStats.fakeVotesReceived += option.voters.filter(
            ({ playerId }) => playerId !== option.authorId
        ).length;
    }
    for (const [voterId, optionId] of state.votes) {
        const playerStats = state.statistics.get(voterId);
        const voteOption = optionsById.get(optionId);
        if (!playerStats || !voteOption) {
            throw new FakeAnswerError(
                "INVALID_VOTE_STATE",
                "A completed vote has no valid result mapping."
            );
        }
        if (voteOption.isCorrect) {
            playerStats.correctVotes += 1;
        } else if (
            voteOption.authorId !== null &&
            voteOption.authorId !== voterId
        ) {
            playerStats.fakeVotesCast += 1;
        }
    }
    for (const player of state.roundParticipants ?? state.participants) {
        state.scores.set(player.id, results.players.find(
            ({ playerId }) => playerId === player.id
        ).totalScore);
    }
    state.scoredRounds.add(state.currentRound);
    state.continueReady = new Set();
    state.results = results;
    state.roundHistory.push({
        round: state.currentRound,
        prompt: state.currentQuestion.text,
        ...results
    });
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
    if (!state.roundEligiblePlayerIds.has(playerId)) {
        throw new FakeAnswerError(
            "SPECTATOR",
            "You are spectating this round and cannot continue the game."
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
    const playerCount = getRequiredContinuePlayers(state).length;
    if (readyCount < playerCount) {
        return {
            ready: true,
            advanced: false,
            readyCount,
            playerCount
        };
    }

    advanceToNextRound(state);
    return {
        ready: true,
        advanced: true,
        readyCount: 0,
        playerCount
    };
}

function removeParticipant(state, playerId) {
    const participantIndex = state.participants.findIndex(({ id }) => id === playerId);
    if (participantIndex === -1) return { removed: false, advancedRound: false };
    state.participants.splice(participantIndex, 1);
    state.connectedPlayerIds.delete(playerId);
    state.roundEligiblePlayerIds.delete(playerId);
    state.continueReady.delete(playerId);
    let needsVoting = false;
    if (state.phase === "answer-submission" && allActiveParticipantsSubmitted(state)) {
        createVotingOptions(state);
        state.phase = "reveal";
        needsVoting = true;
    } else if (state.phase === "reveal") {
        needsVoting = true;
    }
    let advancedRound = false;
    if (state.phase === "voting" && allActiveParticipantsVoted(state)) {
        state.phase = "waiting-for-results";
    }
    if (state.phase === "waiting-for-results") {
        publishResults(state);
    }
    if (state.phase === "results" && state.currentRound < state.totalRounds &&
        state.continueReady.size === getRequiredContinuePlayers(state).length) {
        advanceToNextRound(state);
        advancedRound = true;
    }
    return { removed: true, advancedRound, needsVoting };
}

function suspendParticipant(state, playerId) {
    if (
        !state.participants.some(({ id }) => id === playerId) ||
        !state.roundEligiblePlayerIds.delete(playerId)
    ) {
        return { changed: false, advancedRound: false };
    }

    let needsVoting = false;
    if (state.phase === "answer-submission" && allActiveParticipantsSubmitted(state)) {
        createVotingOptions(state);
        state.phase = "reveal";
        needsVoting = true;
    }
    if (state.phase === "reveal") {
        beginVoting(state);
    }
    if (state.phase === "voting" && allActiveParticipantsVoted(state)) {
        state.phase = "waiting-for-results";
    }
    if (state.phase === "waiting-for-results") {
        publishResults(state);
    }

    let advancedRound = false;
    if (
        state.phase === "results" &&
        state.currentRound < state.totalRounds &&
        state.continueReady.size === getRequiredContinuePlayers(state).length
    ) {
        advanceToNextRound(state);
        advancedRound = true;
    }
    return { changed: true, needsVoting, advancedRound };
}

function setPlayerConnectionStatus(state, playerId, connected) {
    if (!state.participants.some(({ id }) => id === playerId)) {
        return { changed: false, advancedRound: false };
    }
    const wasConnected = state.connectedPlayerIds.has(playerId);
    if (wasConnected === connected) {
        return { changed: false, advancedRound: false };
    }
    if (connected) {
        state.connectedPlayerIds.add(playerId);
        return { changed: true, advancedRound: false };
    }
    state.connectedPlayerIds.delete(playerId);
    return { ...suspendParticipant(state, playerId), changed: true };
}

function isParticipantEligible(state, playerId) {
    return state.roundEligiblePlayerIds.has(playerId);
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
    const viewerState = typeof viewerId === "string"
        ? {
            ...(!state.roundEligiblePlayerIds.has(viewerId)
                ? { viewerIsSpectator: true }
                : {}),
            ...(state.submissions.has(viewerId)
                ? { viewerSubmission: state.submissions.get(viewerId) }
                : {}),
            ...(state.votes.has(viewerId)
                ? { viewerVoteOptionId: state.votes.get(viewerId) }
                : {})
        }
        : {};
    if (state.phase === "results") {
        return {
            ...viewerState,
            phase: state.phase,
            currentRound: state.currentRound,
            totalRounds: state.totalRounds,
            roundId: state.roundId,
            prompt: {
                id: state.roundId,
                text: state.currentQuestion.text
            },
            submissionCount: getRequiredPlayers(
                state,
                (id) => state.submissionStatus.get(id) === true
            ).filter(({ id }) => state.submissionStatus.get(id) === true).length,
            playerCount: state.currentRound === state.totalRounds
                ? state.participants.length
                : getRequiredContinuePlayers(state).length,
            voteCount: state.votes.size,
            isFinalRound: state.currentRound === state.totalRounds,
            ...(state.currentRound < state.totalRounds
                ? {
                    continueReadyCount: state.continueReady.size,
                    continuePlayerCount: getRequiredContinuePlayers(state).length,
                    viewerReadyToContinue: state.continueReady.has(viewerId),
                    continueProgress: getRequiredContinuePlayers(state).map((player) => ({
                        playerId: player.id,
                        name: player.name,
                        ready: state.continueReady.has(player.id)
                    }))
                }
                : {}),
            ...(state.currentRound === state.totalRounds
                ? { finalStatistics: createFinalStatistics(state) }
                : {}),
            results: state.currentRound === state.totalRounds
                ? { ...state.results, roundHistory: state.roundHistory.map((round) => ({ ...round })) }
                : state.results
        };
    }
    return {
        ...viewerState,
        phase: state.phase,
        currentRound: state.currentRound,
        totalRounds: state.totalRounds,
        roundId: state.roundId,
        prompt: state.phase === "waiting-for-results"
            ? null
            : {
                id: state.roundId,
                text: state.currentQuestion.text
            },
        submissionCount: getRequiredPlayers(
            state,
            (id) => state.submissionStatus.get(id) === true
        ).filter(({ id }) => state.submissionStatus.get(id) === true).length,
        playerCount: state.phase === "answer-submission" || state.phase === "reveal"
            ? getRequiredPlayers(state, (id) => state.submissionStatus.get(id) === true).length
            : state.phase === "voting" || state.phase === "waiting-for-results"
              ? getRequiredPlayers(state, (id) => state.votes.has(id)).length
              : state.participants.length,
        ...(state.phase === "answer-submission"
            ? {
                submissionProgress: getRequiredPlayers(
                    state,
                    (id) => state.submissionStatus.get(id) === true
                ).map((player) => ({
                    playerId: player.id,
                    name: player.name,
                    submitted: state.submissionStatus.get(player.id) === true
                }))
            }
            : {}),
        ...(state.phase === "voting" || state.phase === "waiting-for-results"
            ? {
                voteProgress: getRequiredPlayers(state, (id) => state.votes.has(id)).map((player) => ({
                    playerId: player.id,
                    name: player.name,
                    voted: state.votes.has(player.id)
                }))
            }
            : {}),
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
            ? {
                voteCount: getRequiredPlayers(state, (id) => state.votes.has(id))
                    .filter(({ id }) => state.votes.has(id)).length
            }
            : {})
    };
}

function createFakeAnswerGame({ id, displayName, description, questionBank: bank }) {
    if (!bank || typeof bank.selectQuestions !== "function") {
        throw new TypeError("A question bank with selectQuestions(count) is required.");
    }
    return Object.freeze({
        id,
        displayName,
        description,
        supportsRoundSelection: true,
        socketProtocol: "fact-or-cap",
        supportedPlayers: Object.freeze({ min: 2 }),
        createInitialState,
        start(state) {
            return start(state, bank.selectQuestions);
        },
        createPublicState,
        handleAction,
        removeParticipant,
        isParticipantEligible,
        setPlayerConnectionStatus,
        suspendParticipant,
        isFinished(state) {
            return state.phase === "results" && state.currentRound === state.totalRounds;
        },
        calculateRoundResults,
        MAX_COMPLETION_LENGTH
    });
}

const factOrCap = createFakeAnswerGame({
    id: "fact-or-cap",
    displayName: "Fact or Cap",
    description: "A bluffing party game about surprising facts.",
    questionBank
});

module.exports = {
    ...factOrCap,
    FakeAnswerError,
    createFakeAnswerGame,
    normalizeCompletion
};
