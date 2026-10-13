const assert = require("node:assert/strict");
const test = require("node:test");
const gameManager = require("../gameManager");
const gameRegistry = require("../gameRegistry");
const fakeAnswer = require("../games/fake-answer/game");
const anime = require("../games/fake-answer/anime");
const questionBank = require("../games/fake-answer/questionBank");
const bruh = require("../games/bruh-wtf/game");

const players = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase() }));

function readyFakeForVoting(game = fakeAnswer) {
    const state = game.start(game.createInitialState(players), questionBank.selectQuestions);
    game.handleAction(state, "open-submissions");
    for (const player of players) game.handleAction(state, "submit-completion", player.id, `answer ${player.id}`);
    game.handleAction(state, "begin-voting");
    return state;
}

function finishFakeRound(state, game = fakeAnswer) {
    const correct = state.options.find(({ correct }) => correct);
    for (const player of state.participants) game.handleAction(state, "vote", player.id, correct.id);
    game.handleAction(state, "publish-results");
}

function readyBruhForVoting() {
    const state = bruh.start(bruh.createInitialState(players));
    for (const player of players) bruh.handleAction(state, "submit-answer", player.id, `answer ${player.id}`);
    return state;
}

test("Fact-or-Cap and Anime remove a departed submitter and open voting when remaining submissions are complete", () => {
    for (const game of [fakeAnswer, anime]) {
        const state = game.start(game.createInitialState(players), questionBank.selectQuestions);
        game.handleAction(state, "open-submissions");
        game.handleAction(state, "submit-completion", "a", "answer a");
        const result = game.removeParticipant(state, "b");
        assert.equal(result.removed, true);
        assert.equal(state.phase, "answer-submission");
        game.handleAction(state, "submit-completion", "c", "answer c");
        if (state.phase === "reveal") game.handleAction(state, "begin-voting");
        assert.equal(state.phase, "voting");
        assert.deepEqual(state.participants.map(({ id }) => id), ["a", "c"]);
        assert.equal(state.submissionStatus.has("b"), false);
    }
});

test("Fact-or-Cap departure invalidates votes for its answer, permits revoting, and rolls back published scoring", () => {
    const state = readyFakeForVoting();
    const optionFor = (authorId) => state.options.find((option) => option.authorId === authorId);
    fakeAnswer.handleAction(state, "vote", "a", optionFor("b").id);
    fakeAnswer.handleAction(state, "vote", "b", optionFor("a").id);
    fakeAnswer.handleAction(state, "vote", "c", optionFor("a").id);
    fakeAnswer.handleAction(state, "publish-results");
    const priorScores = new Map(state.scores);
    const priorRoundPoints = state.results.players.find(({ playerId }) => playerId === "a").roundPoints;

    fakeAnswer.removeParticipant(state, "b");
    assert.equal(state.phase, "voting");
    assert.equal(state.votes.has("a"), false);
    assert.equal(state.votes.has("c"), true);
    assert.equal(state.options.some(({ authorId }) => authorId === "b"), false);
    assert.equal(state.scores.has("b"), false);
    assert.equal(state.statistics.has("b"), false);
    assert.equal(state.scoredRounds.has(state.currentRound), false);
    assert.equal(state.scores.get("a"), priorScores.get("a") - priorRoundPoints);

    fakeAnswer.handleAction(state, "vote", "a", optionFor("c").id);
    assert.equal(state.phase, "waiting-for-results");
    fakeAnswer.handleAction(state, "publish-results");
    assert.equal(state.phase, "results");
    assert.deepEqual(state.results.players.map(({ playerId }) => playerId).sort(), ["a", "c"]);
    assert.throws(() => fakeAnswer.handleAction(state, "vote", "a", state.options[0].id), { code: "VOTING_NOT_OPEN" });
});

test("Fact-or-Cap advances once when a departure leaves every remaining player ready", () => {
    const state = readyFakeForVoting();
    finishFakeRound(state);
    fakeAnswer.handleAction(state, "continue", "a");
    fakeAnswer.handleAction(state, "continue", "b");
    const removal = fakeAnswer.removeParticipant(state, "c");
    assert.equal(removal.advancedRound, true);
    assert.equal(state.phase, "question");
    assert.equal(state.currentRound, 2);
    assert.equal(state.submissionStatus.size, 2);
    assert.equal(fakeAnswer.removeParticipant(state, "c").advancedRound, false);
});

test("Bruh removal supports two remaining players and invalidates votes for the departed answer", () => {
    const state = readyBruhForVoting();
    const optionFor = (authorId) => state.options.find((option) => option.authorId === authorId);
    bruh.handleAction(state, "vote", "a", optionFor("b").id);
    bruh.handleAction(state, "vote", "b", optionFor("a").id);
    bruh.handleAction(state, "vote", "c", optionFor("a").id);
    bruh.removeParticipant(state, "b");
    assert.equal(state.phase, "voting");
    assert.deepEqual(state.participants.map(({ id }) => id), ["a", "c"]);
    assert.equal(state.votes.has("a"), false);
    assert.equal(state.votes.has("c"), true);
    assert.equal(state.options.some(({ authorId }) => authorId === "b"), false);
    bruh.handleAction(state, "vote", "a", optionFor("c").id);
    assert.equal(state.phase, "waiting-for-results");
    bruh.handleAction(state, "publish-results");
    assert.equal(state.scores.has("b"), false);
    assert.equal(bruh.createPublicState(state, "a").results.activeLeaderboard.length, 2);
});

test("Bruh published results remain historical while departures update active standings and future eligibility", () => {
    const state = bruh.createInitialState(players, { roundCount: 7 });
    bruh.start(state);
    const completedAnswers = state.participants.map(({ id }) => id);
    for (const id of completedAnswers) bruh.handleAction(state, "submit-answer", id, `answer ${id}`);
    for (const player of state.participants) {
        const option = state.options.find(({ authorId }) => authorId !== player.id);
        bruh.handleAction(state, "vote", player.id, option.id);
    }
    bruh.handleAction(state, "publish-results");
    const historical = JSON.stringify(state.results);
    bruh.handleAction(state, "continue", "a");
    bruh.removeParticipant(state, "c");
    const publicState = bruh.createPublicState(state, "a");
    assert.equal(JSON.stringify(state.results), historical);
    assert.deepEqual(publicState.results.activeLeaderboard.map(({ playerId }) => playerId).sort(), ["a", "b"]);
    assert.ok(state.questionOrder.slice(state.currentRound).every(({ requiredPlayers }) => requiredPlayers <= 2));
    assert.equal(state.participants.some(({ id }) => id === "c"), false);
});

test("Bruh advances once when a departure leaves every remaining player ready", () => {
    const state = readyBruhForVoting();
    for (const player of state.participants) {
        const option = state.options.find(({ authorId }) => authorId !== player.id);
        bruh.handleAction(state, "vote", player.id, option.id);
    }
    bruh.handleAction(state, "publish-results");
    bruh.handleAction(state, "continue", "a");
    bruh.handleAction(state, "continue", "b");
    const removal = bruh.removeParticipant(state, "c");
    assert.equal(removal.advancedRound, true);
    assert.equal(state.phase, "answer-submission");
    assert.equal(state.currentRound, 2);
    assert.deepEqual(state.submissionProgress.size, 2);
});

test("game manager removes only the matching session participant and rejects their later actions", () => {
    for (const gameId of ["fact-or-cap", "fact-or-cap-anime", "bruh-wtf"]) {
        const game = gameRegistry.get(gameId);
        const room = { code: `LEAVE-${gameId}`, status: "starting", selectedRoundCount: 5, players };
        const started = gameManager.startGame(room, gameId);
        const removed = gameManager.removeParticipant(room.code, "a", started.sessionId);
        assert.equal(removed.removed, true);
        assert.deepEqual(removed.players.map(({ id }) => id), ["b", "c"]);
        assert.equal(gameManager.removeParticipant(room.code, "a", started.sessionId).removed, false);
        assert.throws(() => gameManager.performGameAction(room.code, gameId, "a", "continue"), { code: "NOT_A_GAME_PLAYER" });
        assert.throws(() => gameManager.getPublicGameState(room.code, "a"), { code: "NOT_A_GAME_PLAYER" });
        assert.equal(gameManager.getPublicGameState(room.code, "b").state.playerCount, 2);
        gameManager.removeGame(room.code, started.sessionId);
        const replacement = gameManager.startGame(room, gameId);
        assert.equal(gameManager.removeParticipant(room.code, "b", started.sessionId), null);
        assert.equal(gameManager.getPublicGameState(room.code, "b").players.length, 3);
        gameManager.removeGame(room.code, replacement.sessionId);
    }
});
