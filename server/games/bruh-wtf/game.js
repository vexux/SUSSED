const { randomInt, randomUUID } = require("node:crypto");
const questionLibrary = require("./questionLibrary");
const { DEFAULT_ROUND_COUNT, isSupportedRoundCount } = require("../../roundConfiguration");

const MAX_ANSWER_LENGTH = 160;

class BruhWtfError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "BruhWtfError";
        this.code = code;
    }
}

function shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swap = randomInt(index + 1);
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}

function resolvePrompt(question, participants) {
    const assignedPlayers = shuffle(participants).slice(0, question.requiredPlayers);
    return question.prompt.replace(/\{\{player(\d+)\}\}/gu, (_match, index) => {
        const player = assignedPlayers[Number(index) - 1];
        if (!player) {
            throw new BruhWtfError("INVALID_QUESTION", "A prompt player placeholder could not be assigned.");
        }
        return player.name.replace(/[{}]/gu, (brace) => brace === "{" ? "｛" : "｝");
    });
}

function createInitialState(players, { roundCount = DEFAULT_ROUND_COUNT } = {}) {
    if (!isSupportedRoundCount(roundCount)) {
        throw new BruhWtfError("INVALID_ROUND_COUNT", "Choose 5, 7, or 10 rounds.");
    }
    const questions = questionLibrary.loadQuestionPacks();
    const eligible = questions.filter(({ requiredPlayers }) => requiredPlayers <= players.length);
    if (eligible.length < roundCount) {
        throw new BruhWtfError(
            "QUESTION_POOL_EXHAUSTED",
            `Bruh wtf? needs ${roundCount} distinct prompts for ${players.length} players; only ${eligible.length} are eligible.`
        );
    }
    return {
        phase: "unstarted",
        currentRound: 0,
        totalRounds: roundCount,
        participants: players.map(({ id, name }) => ({ id, name })),
        // A departure changes future eligibility, not the identities attached
        // to answers and votes already recorded in this round.
        roundParticipants: players.map(({ id, name }) => ({ id, name })),
        questionOrder: shuffle(eligible).slice(0, roundCount),
        currentQuestion: null,
        resolvedPrompt: null,
        submittedAnswers: new Map(),
        submissionProgress: new Map(),
        options: [],
        votes: new Map(),
        scores: new Map(players.map(({ id }) => [id, 0])),
        continueReady: new Set(),
        results: null,
        roundId: null
    };
}

function openRound(state, roundIndex) {
    const question = state.questionOrder[roundIndex];
    if (!question) {
        throw new BruhWtfError("QUESTION_POOL_EXHAUSTED", "No unused prompt is available.");
    }
    state.currentRound = roundIndex + 1;
    state.roundParticipants = state.participants.map(({ id, name }) => ({ id, name }));
    state.currentQuestion = question;
    state.resolvedPrompt = resolvePrompt(question, state.participants);
    state.roundId = randomUUID();
    state.phase = "answer-submission";
    state.submittedAnswers = new Map();
    state.submissionProgress = new Map(state.participants.map(({ id }) => [id, false]));
    state.options = [];
    state.votes = new Map();
    state.continueReady = new Set();
    state.results = null;
}

function start(state) {
    openRound(state, 0);
    return state;
}

function allActiveParticipantsSubmitted(state) {
    return state.participants.every(({ id }) => state.submissionProgress.get(id) === true);
}

function allActiveParticipantsVoted(state) {
    return state.participants.every(({ id }) => state.votes.has(id));
}

function createVotingOptions(state) {
    state.options = shuffle([...state.submittedAnswers].map(([id, completion]) => ({
        id: randomUUID(), authorId: id, completion
    })));
}

function submitAnswer(state, playerId, answer) {
    if (state.phase !== "answer-submission") {
        throw new BruhWtfError("SUBMISSIONS_NOT_OPEN", "Answer submissions are not open.");
    }
    if (!state.submissionProgress.has(playerId)) {
        throw new BruhWtfError("NOT_A_GAME_PLAYER", "You are not participating in this game.");
    }
    if (state.submissionProgress.get(playerId)) {
        throw new BruhWtfError("ALREADY_SUBMITTED", "You have already submitted an answer.");
    }
    if (
        typeof answer !== "string" ||
        answer.trim().length === 0 ||
        answer.trim().length > MAX_ANSWER_LENGTH ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(answer)
    ) {
        throw new BruhWtfError("INVALID_ANSWER", `Enter an answer of up to ${MAX_ANSWER_LENGTH} characters.`);
    }
    state.submittedAnswers.set(playerId, answer.trim());
    state.submissionProgress.set(playerId, true);
    if (allActiveParticipantsSubmitted(state)) {
        createVotingOptions(state);
        state.phase = "voting";
    }
    return {
        submitted: true,
        submissionCount: state.participants.filter(({ id }) => state.submissionProgress.get(id) === true).length,
        playerCount: state.participants.length
    };
}

function vote(state, playerId, optionId) {
    if (state.phase !== "voting") {
        throw new BruhWtfError("VOTING_NOT_OPEN", "Voting is not open.");
    }
    if (!state.participants.some(({ id }) => id === playerId)) {
        throw new BruhWtfError("NOT_A_GAME_PLAYER", "You are not participating in this game.");
    }
    if (state.votes.has(playerId)) {
        throw new BruhWtfError("ALREADY_VOTED", "You have already voted.");
    }
    const option = state.options.find(({ id }) => id === optionId);
    if (!option) {
        throw new BruhWtfError("INVALID_OPTION", "That answer option is not available.");
    }
    if (option.authorId === playerId) {
        throw new BruhWtfError("OWN_ANSWER_NOT_ALLOWED", "You cannot vote for your own answer.");
    }
    state.votes.set(playerId, optionId);
    if (allActiveParticipantsVoted(state)) {
        state.phase = "waiting-for-results";
    }
    return {
        voted: true,
        voteCount: state.participants.filter(({ id }) => state.votes.has(id)).length,
        playerCount: state.participants.length
    };
}

function leaderboard(state) {
    const ranked = state.participants.map(({ id, name }) => ({
        playerId: id,
        name,
        score: state.scores.get(id) ?? 0
    })).sort((first, second) => second.score - first.score || first.playerId.localeCompare(second.playerId));
    let rank = 0;
    let previousScore = null;
    return ranked.map((player, index) => {
        if (player.score !== previousScore) rank = index + 1;
        previousScore = player.score;
        return { ...player, rank };
    });
}

function publishResults(state) {
    if (state.phase === "results") {
        throw new BruhWtfError("RESULTS_ALREADY_PUBLISHED", "This round's results have already been published.");
    }
    if (state.phase !== "waiting-for-results" || !allActiveParticipantsVoted(state)) {
        throw new BruhWtfError("VOTES_NOT_COMPLETE", "Results are not ready until all players have voted.");
    }
    const voteCounts = new Map(state.options.map(({ id }) => [id, 0]));
    const voterIdsByOption = new Map(state.options.map(({ id }) => [id, []]));
    for (const [voterId, optionId] of state.votes) {
        voteCounts.set(optionId, voteCounts.get(optionId) + 1);
        voterIdsByOption.get(optionId).push(voterId);
    }
    const playerById = new Map((state.roundParticipants ?? state.participants).map((player) => [player.id, player]));
    const answers = state.options.map((option) => {
        const count = voteCounts.get(option.id);
        state.scores.set(option.authorId, state.scores.get(option.authorId) + count);
        return {
            completion: option.completion,
            authorId: option.authorId,
            authorName: playerById.get(option.authorId).name,
            voterNames: voterIdsByOption.get(option.id).map((id) => playerById.get(id).name),
            voteCount: count,
            pointsAwarded: count
        };
    });
    const leaderboardState = leaderboard(state);
    const highScore = leaderboardState[0]?.score ?? 0;
    state.results = {
        prompt: state.resolvedPrompt,
        answers,
        roundScores: state.participants.map(({ id, name }) => ({
            playerId: id,
            name,
            pointsEarned: answers.find(({ authorId }) => authorId === id).pointsAwarded
        })),
        leaderboard: leaderboardState,
        ...(state.currentRound === state.totalRounds
            ? { winners: leaderboardState.filter(({ score }) => score === highScore).map(({ playerId, name }) => ({ playerId, name })) }
            : {})
    };
    state.phase = "results";
    return { published: true, currentRound: state.currentRound };
}

function continueRound(state, playerId) {
    if (state.phase !== "results") {
        throw new BruhWtfError("RESULTS_NOT_READY", "The round results must be available before continuing.");
    }
    if (state.currentRound >= state.totalRounds) {
        throw new BruhWtfError("GAME_FINISHED", "The final round is complete.");
    }
    if (!state.participants.some(({ id }) => id === playerId)) {
        throw new BruhWtfError("NOT_A_GAME_PLAYER", "You are not participating in this game.");
    }
    if (state.continueReady.has(playerId)) {
        throw new BruhWtfError("ALREADY_READY", "You are already ready to continue.");
    }
    state.continueReady.add(playerId);
    if (state.continueReady.size < state.participants.length) {
        return { ready: true, advanced: false, readyCount: state.continueReady.size, playerCount: state.participants.length };
    }
    openRound(state, state.currentRound);
    return { ready: true, advanced: true, readyCount: 0, playerCount: state.participants.length };
}

function removeParticipant(state, playerId) {
    const participantIndex = state.participants.findIndex(({ id }) => id === playerId);
    if (participantIndex === -1) return { removed: false, advancedRound: false };
    // Resolve the only file-backed input before mutating session state so a
    // content-loading error cannot strand room and game membership out of sync.
    const allQuestions = questionLibrary.loadQuestionPacks();
    const wasPublished = state.phase === "results";
    state.participants.splice(participantIndex, 1);
    state.continueReady.delete(playerId);

    const currentAndPast = state.questionOrder.slice(0, state.currentRound);
    const usedIds = new Set(currentAndPast.map(({ id }) => id));
    const future = state.questionOrder.slice(state.currentRound)
        .filter(({ id, requiredPlayers }) => requiredPlayers <= state.participants.length && !usedIds.has(id));
    for (const { id } of future) usedIds.add(id);
    const futureTarget = state.totalRounds - state.currentRound;
    const replacements = shuffle(allQuestions.filter(({ id, requiredPlayers }) =>
        requiredPlayers <= state.participants.length && !usedIds.has(id)
    ));
    while (future.length < futureTarget && replacements.length) {
        const question = replacements.shift();
        future.push(question);
        usedIds.add(question.id);
    }
    state.questionOrder = [...currentAndPast, ...future];
    state.totalRounds = state.currentRound + future.length;

    let advancedRound = false;
    if (!wasPublished && state.phase === "answer-submission" && allActiveParticipantsSubmitted(state)) {
        createVotingOptions(state);
        state.phase = "voting";
    }
    if (!wasPublished && state.phase === "voting" && allActiveParticipantsVoted(state)) {
        state.phase = "waiting-for-results";
    }
    if (state.phase === "waiting-for-results") publishResults(state);

    if (wasPublished && state.currentRound < state.totalRounds &&
        state.continueReady.size === state.participants.length) {
        openRound(state, state.currentRound);
        advancedRound = true;
    }
    return { removed: true, advancedRound };
}

function handleAction(state, action, playerId, payload) {
    switch (action) {
        case "submit-answer": return submitAnswer(state, playerId, payload);
        case "vote": return vote(state, playerId, payload);
        case "publish-results": return publishResults(state);
        case "continue": return continueRound(state, playerId);
        default: throw new BruhWtfError("UNKNOWN_ACTION", "That game action is not available.");
    }
}

function createPublicState(state, viewerId) {
    const base = {
        phase: state.phase,
        currentRound: state.currentRound,
        totalRounds: state.totalRounds,
        roundId: state.roundId,
        prompt: state.resolvedPrompt,
        playerCount: state.participants.length
    };
    if (state.phase === "answer-submission") {
        return {
            ...base,
            submissionCount: state.participants.filter(({ id }) => state.submissionProgress.get(id) === true).length,
            submissionProgress: state.participants.map(({ id, name }) => ({
                playerId: id,
                name,
                submitted: state.submissionProgress.get(id) === true
            }))
        };
    }
    if (state.phase === "voting") {
        return {
            ...base,
            voteCount: state.participants.filter(({ id }) => state.votes.has(id)).length,
            voteProgress: state.participants.map(({ id, name }) => ({ playerId: id, name, voted: state.votes.has(id) })),
            options: state.options
                .map(({ id, completion, authorId }) => ({
                    id,
                    completion,
                    isOwnAnswer: authorId === viewerId
                }))
        };
    }
    if (state.phase === "waiting-for-results") {
        return {
            ...base,
            voteCount: state.participants.filter(({ id }) => state.votes.has(id)).length,
            voteProgress: state.participants.map(({ id, name }) => ({ playerId: id, name, voted: state.votes.has(id) }))
        };
    }
    if (state.phase === "results") {
        const activeLeaderboard = leaderboard(state);
        const highestScore = activeLeaderboard[0]?.score ?? 0;
        return {
            ...base,
            continueReadyCount: state.continueReady.size,
            continuePlayerCount: state.participants.length,
            viewerReadyToContinue: state.continueReady.has(viewerId),
            continueProgress: state.participants.map(({ id, name }) => ({ playerId: id, name, ready: state.continueReady.has(id) })),
            results: {
                ...state.results,
                activeLeaderboard,
                activeWinners: activeLeaderboard
                    .filter(({ score }) => score === highestScore)
                    .map(({ playerId, name }) => ({ playerId, name }))
            }
        };
    }
    return base;
}

module.exports = {
    id: "bruh-wtf",
    displayName: "Bruh wtf?",
    description: "A multiplayer prompt game where players answer and vote for each other's funniest responses.",
    socketProtocol: "bruh-wtf",
    // Three players are the minimum that allows at least two anonymous vote
    // options after excluding the viewer's own answer.
    supportedPlayers: Object.freeze({ min: 3 }),
    createInitialState,
    resolvePrompt,
    start,
    handleAction,
    removeParticipant,
    createPublicState,
    isFinished: (state) => state.phase === "results" && state.currentRound === state.totalRounds,
    BruhWtfError,
    MAX_ANSWER_LENGTH
};
