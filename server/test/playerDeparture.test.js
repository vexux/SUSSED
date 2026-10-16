const assert = require("node:assert/strict");
const test = require("node:test");
const gameManager = require("../gameManager");
const gameRegistry = require("../gameRegistry");
const fakeAnswer = require("../games/fake-answer/game");
const anime = require("../games/fake-answer/anime");
const questionBank = require("../games/fake-answer/questionBank");
const bruh = require("../games/bruh-wtf/game");

const players = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase() }));
const fakeGames = [fakeAnswer, anime];

function readyFakeForVoting(game, roster = players) {
    const state = game.start(game.createInitialState(roster), questionBank.selectQuestions);
    game.handleAction(state, "open-submissions");
    for (const player of roster) game.handleAction(state, "submit-completion", player.id, `answer ${player.id}`);
    game.handleAction(state, "begin-voting");
    return state;
}

function finishFakeRound(state, game) {
    const correct = state.options.find(({ correct }) => correct);
    for (const player of state.participants) game.handleAction(state, "vote", player.id, correct.id);
    game.handleAction(state, "publish-results");
}

function readyBruhForVoting(roster = players) {
    const state = bruh.start(bruh.createInitialState(roster));
    for (const player of roster) bruh.handleAction(state, "submit-answer", player.id, `answer ${player.id}`);
    return state;
}

test("Fact-or-Cap and Anime preserve a submitted leaver's answer and reconcile remaining submissions", () => {
    for (const game of fakeGames) {
        const state = game.start(game.createInitialState(players), questionBank.selectQuestions);
        game.handleAction(state, "open-submissions");
        game.handleAction(state, "submit-completion", "a", "answer a");
        game.handleAction(state, "submit-completion", "b", "answer b");

        const departure = game.removeParticipant(state, "b");
        assert.equal(departure.removed, true);
        assert.equal(state.submissions.get("b"), "answer b");
        assert.equal(state.submissionStatus.get("b"), true);
        assert.deepEqual(state.participants.map(({ id }) => id), ["a", "c"]);
        game.handleAction(state, "submit-completion", "c", "answer c");
        assert.equal(state.phase, "reveal");
        assert.ok(state.options.some(({ authorId, completion }) => authorId === "b" && completion === "answer b"));
        game.handleAction(state, "begin-voting");

        const publicState = game.createPublicState(state, "a");
        assert.equal(publicState.playerCount, 2);
        assert.equal(publicState.submissionCount, 2);
        assert.deepEqual(publicState.voteProgress.map(({ playerId }) => playerId), ["a", "c"]);
        assert.equal(game.removeParticipant(state, "b").removed, false);
        assert.throws(() => game.handleAction(state, "vote", "b", state.options[0].id), { code: "NOT_A_GAME_PLAYER" });
    }
});

test("last unsubmitted departure advances Fact-or-Cap through reveal and Bruh directly to voting", () => {
    for (const game of fakeGames) {
        const state = game.start(game.createInitialState(players), questionBank.selectQuestions);
        game.handleAction(state, "open-submissions");
        game.handleAction(state, "submit-completion", "a", "answer a");
        game.handleAction(state, "submit-completion", "b", "answer b");
        const departure = game.removeParticipant(state, "c");
        assert.equal(departure.needsVoting, true);
        assert.equal(state.phase, "reveal");
        assert.equal(state.submissions.has("c"), false);
        game.handleAction(state, "begin-voting");
        assert.equal(state.phase, "voting");
        assert.throws(() => game.handleAction(state, "vote", "c", state.options[0].id), { code: "NOT_A_GAME_PLAYER" });
        assert.equal(state.options.some(({ authorId }) => authorId === "c"), false);
        const correct = state.options.find(({ correct: isCorrect }) => isCorrect);
        game.handleAction(state, "vote", "a", correct.id);
        game.handleAction(state, "vote", "b", correct.id);
        game.handleAction(state, "publish-results");
        const departedResult = state.results.players.find(({ playerId }) => playerId === "c");
        assert.equal(departedResult.submittedCompletion, null);
        assert.equal(departedResult.voteOptionId, null);
        assert.equal(departedResult.roundPoints, 0);
    }

    const state = bruh.start(bruh.createInitialState(players));
    bruh.handleAction(state, "submit-answer", "a", "answer a");
    bruh.handleAction(state, "submit-answer", "b", "answer b");
    bruh.removeParticipant(state, "c");
    assert.equal(state.phase, "voting");
    assert.equal(state.submittedAnswers.has("c"), false);
    assert.deepEqual(state.options.map(({ authorId }) => authorId).sort(), ["a", "b"]);
    assert.throws(() => bruh.handleAction(state, "vote", "c", state.options[0].id), { code: "NOT_A_GAME_PLAYER" });
    for (const player of state.participants) {
        const option = state.options.find(({ authorId }) => authorId !== player.id);
        bruh.handleAction(state, "vote", player.id, option.id);
    }
    bruh.handleAction(state, "publish-results");
    assert.equal(state.results.answers.some(({ authorId }) => authorId === "c"), false);
});

test("Fact-or-Cap variants preserve departed answers and votes and score the round exactly once", () => {
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game);
        const optionFor = (authorId) => state.options.find((option) => option.authorId === authorId);
        const correct = state.options.find(({ correct }) => correct);
        game.handleAction(state, "vote", "a", optionFor("b").id);
        game.handleAction(state, "vote", "b", optionFor("c").id);
        game.handleAction(state, "vote", "c", correct.id);
        const priorVotes = [...state.votes];

        game.removeParticipant(state, "c");
        assert.equal(state.phase, "results");
        assert.deepEqual([...state.votes], priorVotes);
        assert.ok(state.options.some(({ authorId }) => authorId === "c"));
        assert.equal(state.scores.get("c"), 3);
        assert.equal(state.statistics.get("c").correctVotes, 1);
        assert.equal(state.results.players.length, 3);
        assert.equal(state.results.roundPlayerCount, 3);
        assert.equal(state.results.options.find(({ authorId }) => authorId === "c").voters[0].playerId, "b");

        const published = JSON.stringify(state.results);
        const scores = [...state.scores];
        assert.equal(game.removeParticipant(state, "c").removed, false);
        assert.throws(() => game.handleAction(state, "publish-results"), { code: "RESULTS_ALREADY_PUBLISHED" });
        assert.equal(JSON.stringify(state.results), published);
        assert.deepEqual([...state.scores], scores);
        assert.throws(() => game.handleAction(state, "vote", "c", correct.id), { code: "VOTING_NOT_OPEN" });
    }
});

test("departed unvoted players are no longer required; recorded votes settle results immediately", () => {
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game);
        const optionFor = (authorId) => state.options.find((option) => option.authorId === authorId);
        game.handleAction(state, "vote", "a", optionFor("b").id);
        game.handleAction(state, "vote", "b", optionFor("c").id);
        assert.equal(state.phase, "voting");

        game.removeParticipant(state, "c");
        assert.equal(state.phase, "results");
        assert.equal(state.votes.size, 2);
        assert.equal(state.results.options.find(({ authorId }) => authorId === "c").voters.length, 1);
        assert.equal(state.scores.get("c"), 1);
        assert.equal(game.createPublicState(state, "a").playerCount, 2);
    }

    const state = readyBruhForVoting();
    const optionFor = (authorId) => state.options.find(({ authorId: owner }) => owner === authorId);
    bruh.handleAction(state, "vote", "a", optionFor("b").id);
    bruh.handleAction(state, "vote", "b", optionFor("c").id);
    bruh.removeParticipant(state, "c");
    assert.equal(state.phase, "results");
    assert.equal(state.votes.size, 2);
    assert.equal(state.results.answers.find(({ authorId }) => authorId === "c").voteCount, 1);
    assert.equal(state.scores.get("c"), 1);
    assert.equal(bruh.createPublicState(state, "a").playerCount, 2);
});

test("departure while waiting for publication reconciles once and publication cannot score twice", () => {
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game);
        const option = state.options.find(({ correct }) => correct);
        for (const player of players) game.handleAction(state, "vote", player.id, option.id);
        assert.equal(state.phase, "waiting-for-results");
        game.removeParticipant(state, "c");
        assert.equal(state.phase, "results");
        assert.equal(state.scoredRounds.size, 1);
        const resultJson = JSON.stringify(state.results);
        const scoreJson = JSON.stringify([...state.scores]);
        assert.throws(() => game.handleAction(state, "publish-results"), { code: "RESULTS_ALREADY_PUBLISHED" });
        assert.equal(JSON.stringify(state.results), resultJson);
        assert.equal(JSON.stringify([...state.scores]), scoreJson);
    }

    const state = readyBruhForVoting();
    for (const player of players) {
        const option = state.options.find(({ authorId }) => authorId !== player.id);
        bruh.handleAction(state, "vote", player.id, option.id);
    }
    assert.equal(state.phase, "waiting-for-results");
    bruh.removeParticipant(state, "c");
    assert.equal(state.phase, "results");
    const resultJson = JSON.stringify(state.results);
    const scoreJson = JSON.stringify([...state.scores]);
    assert.throws(() => bruh.handleAction(state, "publish-results"), { code: "RESULTS_ALREADY_PUBLISHED" });
    assert.equal(JSON.stringify(state.results), resultJson);
    assert.equal(JSON.stringify([...state.scores]), scoreJson);
});

test("published results, scores, and statistics remain immutable after a player leaves", () => {
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game);
        finishFakeRound(state, game);
        const results = JSON.stringify(state.results);
        const scores = JSON.stringify([...state.scores]);
        const statistics = JSON.stringify([...state.statistics]);
        const departure = game.removeParticipant(state, "c");
        assert.equal(departure.removed, true);
        assert.equal(state.phase, "results");
        assert.equal(JSON.stringify(state.results), results);
        assert.equal(JSON.stringify([...state.scores]), scores);
        assert.equal(JSON.stringify([...state.statistics]), statistics);
        assert.equal(state.scores.has("c"), true);
        assert.equal(state.statistics.has("c"), true);
        assert.equal(game.createPublicState(state, "a").playerCount, 2);
    }

    const state = readyBruhForVoting();
    for (const player of players) {
        const option = state.options.find(({ authorId }) => authorId !== player.id);
        bruh.handleAction(state, "vote", player.id, option.id);
    }
    bruh.handleAction(state, "publish-results");
    const results = JSON.stringify(state.results);
    const scores = JSON.stringify([...state.scores]);
    bruh.removeParticipant(state, "c");
    assert.equal(state.phase, "results");
    assert.equal(JSON.stringify(state.results), results);
    assert.equal(JSON.stringify([...state.scores]), scores);
    assert.equal(state.scores.has("c"), true);
});

test("departures during submission or voting preserve roster invariants across repeated removals", () => {
    for (const game of fakeGames) {
        const state = game.start(game.createInitialState(players), questionBank.selectQuestions);
        game.handleAction(state, "open-submissions");
        game.handleAction(state, "submit-completion", "a", "answer a");
        game.handleAction(state, "submit-completion", "b", "answer b");
        game.removeParticipant(state, "c");
        assert.deepEqual(state.participants.map(({ id }) => id), ["a", "b"]);
        assert.equal(game.removeParticipant(state, "c").removed, false);
        assert.equal(state.submissions.get("a"), "answer a");
        assert.equal(state.submissions.get("b"), "answer b");
        assert.equal(state.phase, "reveal");
        game.handleAction(state, "begin-voting");
        assert.equal(state.phase, "voting");
    }

    const state = readyBruhForVoting();
    bruh.handleAction(state, "vote", "a", state.options.find(({ authorId }) => authorId === "b").id);
    bruh.handleAction(state, "vote", "b", state.options.find(({ authorId }) => authorId === "a").id);
    bruh.removeParticipant(state, "c");
    assert.equal(state.phase, "results");
    assert.deepEqual(state.participants.map(({ id }) => id), ["a", "b"]);
    assert.equal(state.submittedAnswers.get("c"), "answer c");
    assert.equal(state.votes.has("a"), true);
    assert.equal(state.votes.has("b"), true);
});

test("multiple departures preserve votes and options while the remaining active voters finish", () => {
    const fourPlayers = [...players, { id: "d", name: "D" }];
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game, fourPlayers);
        const optionFor = (authorId) => state.options.find(({ authorId: owner }) => owner === authorId);
        game.handleAction(state, "vote", "a", optionFor("c").id);
        game.handleAction(state, "vote", "b", optionFor("d").id);
        game.removeParticipant(state, "d");
        assert.equal(state.phase, "voting");
        assert.equal(state.options.some(({ authorId }) => authorId === "d"), true);
        game.removeParticipant(state, "c");
        assert.equal(state.phase, "results");
        assert.equal(state.votes.size, 2);
        assert.equal(state.results.options.find(({ authorId }) => authorId === "c").voters[0].playerId, "a");
        assert.equal(state.results.options.find(({ authorId }) => authorId === "d").voters[0].playerId, "b");
        assert.equal(state.scores.get("c"), 1);
        assert.equal(state.scores.get("d"), 1);
    }

    const state = readyBruhForVoting(fourPlayers);
    const optionFor = (authorId) => state.options.find(({ authorId: owner }) => owner === authorId);
    bruh.handleAction(state, "vote", "a", optionFor("c").id);
    bruh.handleAction(state, "vote", "b", optionFor("d").id);
    bruh.removeParticipant(state, "d");
    assert.equal(state.phase, "voting");
    bruh.removeParticipant(state, "c");
    assert.equal(state.phase, "results");
    assert.equal(state.votes.size, 2);
    assert.equal(state.results.answers.find(({ authorId }) => authorId === "c").voterNames[0], "A");
    assert.equal(state.results.answers.find(({ authorId }) => authorId === "d").voterNames[0], "B");
    assert.equal(state.scores.get("c"), 1);
    assert.equal(state.scores.get("d"), 1);
});

test("multiple departed voters keep their votes while active voters finish the round", () => {
    const fourPlayers = [...players, { id: "d", name: "D" }];
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game, fourPlayers);
        const optionFor = (authorId) => state.options.find(({ authorId: owner }) => owner === authorId);
        game.handleAction(state, "vote", "a", optionFor("b").id);
        game.handleAction(state, "vote", "b", optionFor("a").id);
        game.removeParticipant(state, "a");
        assert.equal(state.phase, "voting");
        game.removeParticipant(state, "b");
        assert.equal(state.phase, "voting");
        assert.equal(state.votes.size, 2);
        game.handleAction(state, "vote", "c", optionFor("b").id);
        game.handleAction(state, "vote", "d", optionFor("a").id);
        assert.equal(state.phase, "waiting-for-results");
        game.handleAction(state, "publish-results");
        assert.equal(state.phase, "results");
        assert.equal(state.votes.size, 4);
        assert.equal(state.results.options.find(({ authorId }) => authorId === "b").voters.length, 2);
        assert.equal(state.results.options.find(({ authorId }) => authorId === "a").voters.length, 2);
        assert.equal(state.scores.get("a"), 2);
        assert.equal(state.scores.get("b"), 2);
    }

    const state = readyBruhForVoting(fourPlayers);
    const optionFor = (authorId) => state.options.find(({ authorId: owner }) => owner === authorId);
    bruh.handleAction(state, "vote", "a", optionFor("b").id);
    bruh.handleAction(state, "vote", "b", optionFor("a").id);
    bruh.removeParticipant(state, "a");
    bruh.removeParticipant(state, "b");
    assert.equal(state.phase, "voting");
    bruh.handleAction(state, "vote", "c", optionFor("b").id);
    bruh.handleAction(state, "vote", "d", optionFor("a").id);
    assert.equal(state.phase, "waiting-for-results");
    bruh.handleAction(state, "publish-results");
    assert.equal(state.votes.size, 4);
    assert.equal(state.results.answers.find(({ authorId }) => authorId === "b").voteCount, 2);
    assert.equal(state.results.answers.find(({ authorId }) => authorId === "a").voteCount, 2);
    assert.equal(state.scores.get("a"), 2);
    assert.equal(state.scores.get("b"), 2);
});

test("all remaining players ready at departure advance exactly once with a fresh round roster", () => {
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game);
        finishFakeRound(state, game);
        game.handleAction(state, "continue", "a");
        game.handleAction(state, "continue", "b");
        const removal = game.removeParticipant(state, "c");
        assert.equal(removal.advancedRound, true);
        assert.equal(state.phase, "question");
        assert.equal(state.currentRound, 2);
        assert.deepEqual(state.roundParticipants.map(({ id }) => id), ["a", "b"]);
        assert.equal(game.removeParticipant(state, "c").advancedRound, false);
    }

    const state = readyBruhForVoting();
    for (const player of players) {
        const option = state.options.find(({ authorId }) => authorId !== player.id);
        bruh.handleAction(state, "vote", player.id, option.id);
    }
    bruh.handleAction(state, "publish-results");
    bruh.handleAction(state, "continue", "a");
    bruh.handleAction(state, "continue", "b");
    const removal = bruh.removeParticipant(state, "c");
    assert.equal(removal.advancedRound, true);
    assert.equal(state.currentRound, 2);
    assert.equal(state.phase, "answer-submission");
    assert.deepEqual(state.roundParticipants.map(({ id }) => id), ["a", "b"]);
});

test("game manager keeps removed players out of future actions and preserves current published session data", () => {
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
