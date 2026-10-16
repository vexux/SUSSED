const assert = require("node:assert/strict");
const test = require("node:test");
const gameManager = require("../gameManager");
const gameRegistry = require("../gameRegistry");
const fakeAnswer = require("../games/fake-answer/game");
const anime = require("../games/fake-answer/anime");
const questionBank = require("../games/fake-answer/questionBank");
const fakeAnswerSocketHandlers = require("../games/fake-answer/socketHandlers");
const bruh = require("../games/bruh-wtf/game");

function captureSubmissionCallback(io, roomCode, sessionId, roundId, gameId = "fact-or-cap") {
    const scheduled = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay, ...args) => {
        assert.equal(delay, 1500);
        scheduled.push(() => callback(...args));
        return { unref() {} };
    };
    try {
        fakeAnswerSocketHandlers.scheduleSubmissionPhase(
            io,
            roomCode,
            sessionId,
            roundId,
            gameId
        );
    } finally {
        global.setTimeout = originalSetTimeout;
    }
    assert.equal(scheduled.length, 1);
    return scheduled[0];
}

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

test("a submitted leaver keeps their answer but receives no fabricated vote or score", () => {
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game);
        const optionFor = (authorId) => state.options.find((option) => option.authorId === authorId);
        game.handleAction(state, "vote", "b", optionFor("c").id);
        game.removeParticipant(state, "c");
        assert.equal(state.submissions.get("c"), "answer c");
        assert.equal(state.votes.has("c"), false);
        game.handleAction(state, "vote", "a", optionFor("b").id);
        game.handleAction(state, "publish-results");

        const departed = state.results.players.find(({ playerId }) => playerId === "c");
        const answer = state.results.options.find(({ authorId }) => authorId === "c");
        assert.equal(departed.submittedCompletion, "answer c");
        assert.equal(departed.voteOptionId, null);
        assert.equal(departed.voteCompletion, null);
        assert.equal(departed.voteCorrect, null);
        assert.equal(departed.roundPoints, 1);
        assert.equal(answer.completion, "answer c");
        assert.deepEqual(answer.voters.map(({ playerId }) => playerId), ["b"]);
        assert.equal(state.statistics.get("c").fakeVotesReceived, 1);
    }

    const state = readyBruhForVoting();
    const optionFor = (authorId) => state.options.find(({ authorId: owner }) => owner === authorId);
    bruh.handleAction(state, "vote", "b", optionFor("c").id);
    bruh.removeParticipant(state, "c");
    assert.equal(state.submittedAnswers.get("c"), "answer c");
    assert.equal(state.votes.has("c"), false);
    bruh.handleAction(state, "vote", "a", optionFor("b").id);
    bruh.handleAction(state, "publish-results");
    const answer = state.results.answers.find(({ authorId }) => authorId === "c");
    assert.equal(answer.completion, "answer c");
    assert.equal(answer.voteCount, 1);
    assert.deepEqual(answer.voterNames, ["B"]);
    assert.equal(state.scores.get("c"), 1);
});

test("departed players cannot act in a later round and a final-round departure cannot advance", () => {
    for (const game of fakeGames) {
        const state = game.start(game.createInitialState(players, { roundCount: 5 }), questionBank.selectQuestions);
        const staleRoundId = state.roundId;
        game.handleAction(state, "open-submissions");
        game.handleAction(state, "submit-completion", "a", "answer a");
        game.handleAction(state, "submit-completion", "b", "answer b");
        game.removeParticipant(state, "c");
        game.handleAction(state, "begin-voting");
        const correct = state.options.find(({ correct: isCorrect }) => isCorrect);
        game.handleAction(state, "vote", "a", correct.id);
        game.handleAction(state, "vote", "b", correct.id);
        game.handleAction(state, "publish-results");
        game.handleAction(state, "continue", "a");
        game.handleAction(state, "continue", "b");

        assert.equal(state.phase, "question");
        assert.throws(() => game.handleAction(state, "open-submissions", null, { roundId: staleRoundId }), { code: "ROUND_MISMATCH" });
        assert.equal(state.phase, "question");
        game.handleAction(state, "open-submissions");
        assert.throws(() => game.handleAction(state, "submit-completion", "c", "late answer"), { code: "NOT_A_GAME_PLAYER" });
        game.handleAction(state, "submit-completion", "a", "round two a");
        game.handleAction(state, "submit-completion", "b", "round two b");
        game.handleAction(state, "begin-voting");
        assert.throws(() => game.handleAction(state, "vote", "c", state.options[0].id), { code: "NOT_A_GAME_PLAYER" });
        for (const playerId of ["a", "b"]) game.handleAction(state, "vote", playerId, state.options.find(({ correct: isCorrect }) => isCorrect).id);
        game.handleAction(state, "publish-results");
        assert.throws(() => game.handleAction(state, "continue", "c"), { code: "NOT_A_GAME_PLAYER" });
        assert.deepEqual(state.roundParticipants.map(({ id }) => id), ["a", "b"]);
    }

    const state = bruh.start(bruh.createInitialState(players, { roundCount: 5 }));
    for (const player of players) bruh.handleAction(state, "submit-answer", player.id, `answer ${player.id}`);
    bruh.removeParticipant(state, "c");
    for (const player of state.participants) {
        bruh.handleAction(state, "vote", player.id, state.options.find(({ authorId }) => authorId !== player.id).id);
    }
    bruh.handleAction(state, "publish-results");
    bruh.handleAction(state, "continue", "a");
    bruh.handleAction(state, "continue", "b");
    assert.throws(() => bruh.handleAction(state, "submit-answer", "c", "late answer"), { code: "NOT_A_GAME_PLAYER" });
    bruh.handleAction(state, "submit-answer", "a", "round two a");
    bruh.handleAction(state, "submit-answer", "b", "round two b");
    assert.throws(() => bruh.handleAction(state, "vote", "c", state.options[0].id), { code: "NOT_A_GAME_PLAYER" });
    for (const player of state.participants) {
        bruh.handleAction(state, "vote", player.id, state.options.find(({ authorId }) => authorId !== player.id).id);
    }
    bruh.handleAction(state, "publish-results");
    assert.throws(() => bruh.handleAction(state, "continue", "c"), { code: "NOT_A_GAME_PLAYER" });
    assert.deepEqual(state.roundParticipants.map(({ id }) => id), ["a", "b"]);

    for (const game of fakeGames) {
        const finalState = game.start(game.createInitialState(players, { roundCount: 5 }), questionBank.selectQuestions);
        for (let round = 1; round <= finalState.totalRounds; round += 1) {
            game.handleAction(finalState, "open-submissions");
            for (const player of finalState.participants) game.handleAction(finalState, "submit-completion", player.id, `final ${round} ${player.id}`);
            game.handleAction(finalState, "begin-voting");
            const correct = finalState.options.find(({ correct: isCorrect }) => isCorrect);
            for (const player of finalState.participants) game.handleAction(finalState, "vote", player.id, correct.id);
            game.handleAction(finalState, "publish-results");
            if (round < finalState.totalRounds) {
                for (const player of [...finalState.participants]) game.handleAction(finalState, "continue", player.id);
            }
        }
        const removal = game.removeParticipant(finalState, "c");
        assert.equal(removal.advancedRound, false);
        assert.equal(finalState.phase, "results");
        assert.equal(finalState.currentRound, finalState.totalRounds);
        assert.ok(finalState.results);
    }

    const finalBruh = bruh.start(bruh.createInitialState(players, { roundCount: 5 }));
    for (let round = 1; round <= finalBruh.totalRounds; round += 1) {
        for (const player of finalBruh.participants) bruh.handleAction(finalBruh, "submit-answer", player.id, `final ${round} ${player.id}`);
        for (const player of finalBruh.participants) bruh.handleAction(finalBruh, "vote", player.id, finalBruh.options.find(({ authorId }) => authorId !== player.id).id);
        bruh.handleAction(finalBruh, "publish-results");
        if (round < finalBruh.totalRounds) {
            for (const player of [...finalBruh.participants]) bruh.handleAction(finalBruh, "continue", player.id);
        }
    }
    assert.equal(bruh.removeParticipant(finalBruh, "c").advancedRound, false);
    assert.equal(finalBruh.phase, "results");
    assert.equal(finalBruh.currentRound, finalBruh.totalRounds);
});

test("departure before the final Continue keeps readiness valid and advances once after the last active player responds", () => {
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game);
        finishFakeRound(state, game);
        const previousScores = [...state.scores];
        game.removeParticipant(state, "c");
        assert.deepEqual([...state.continueReady], []);
        assert.throws(() => game.handleAction(state, "continue", "c"), { code: "NOT_A_GAME_PLAYER" });
        assert.equal(game.handleAction(state, "continue", "a").advanced, false);
        const finalContinue = game.handleAction(state, "continue", "b");
        assert.equal(finalContinue.advanced, true);
        assert.equal(state.currentRound, 2);
        assert.deepEqual(state.roundParticipants.map(({ id }) => id), ["a", "b"]);
        assert.deepEqual([...state.scores], previousScores);
    }

    const state = readyBruhForVoting();
    for (const player of players) {
        const option = state.options.find(({ authorId }) => authorId !== player.id);
        bruh.handleAction(state, "vote", player.id, option.id);
    }
    bruh.handleAction(state, "publish-results");
    const previousScores = [...state.scores];
    bruh.removeParticipant(state, "c");
    assert.deepEqual([...state.continueReady], []);
    assert.throws(() => bruh.handleAction(state, "continue", "c"), { code: "NOT_A_GAME_PLAYER" });
    assert.equal(bruh.handleAction(state, "continue", "a").advanced, false);
    assert.equal(bruh.handleAction(state, "continue", "b").advanced, true);
    assert.equal(state.currentRound, 2);
    assert.deepEqual(state.roundParticipants.map(({ id }) => id), ["a", "b"]);
    assert.deepEqual([...state.scores], previousScores);
});

test("two departures while readiness changes do not advance the next round more than once", () => {
    const fivePlayers = [...players, { id: "d", name: "D" }, { id: "e", name: "E" }];
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game, fivePlayers);
        finishFakeRound(state, game);
        assert.equal(game.handleAction(state, "continue", "a").advanced, false);
        assert.equal(game.handleAction(state, "continue", "b").advanced, false);
        assert.equal(game.removeParticipant(state, "d").advancedRound, false);
        assert.equal(game.handleAction(state, "continue", "c").advanced, false);
        const secondDeparture = game.removeParticipant(state, "e");
        assert.equal(secondDeparture.advancedRound, true);
        assert.equal(state.currentRound, 2);
        assert.equal(state.phase, "question");
        assert.deepEqual(state.roundParticipants.map(({ id }) => id), ["a", "b", "c"]);
        assert.equal(game.removeParticipant(state, "e").advancedRound, false);
    }

    const state = readyBruhForVoting(fivePlayers);
    for (const player of fivePlayers) {
        bruh.handleAction(state, "vote", player.id, state.options.find(({ authorId }) => authorId !== player.id).id);
    }
    bruh.handleAction(state, "publish-results");
    assert.equal(bruh.handleAction(state, "continue", "a").advanced, false);
    assert.equal(bruh.handleAction(state, "continue", "b").advanced, false);
    assert.equal(bruh.removeParticipant(state, "d").advancedRound, false);
    assert.equal(bruh.handleAction(state, "continue", "c").advanced, false);
    assert.equal(bruh.removeParticipant(state, "e").advancedRound, true);
    assert.equal(state.currentRound, 2);
    assert.equal(state.phase, "answer-submission");
    assert.deepEqual(state.roundParticipants.map(({ id }) => id), ["a", "b", "c"]);
    assert.equal(bruh.removeParticipant(state, "e").advancedRound, false);
});

test("scheduled submission callbacks are single-use and cannot mutate later rounds, replacement sessions, or cleaned games", (context) => {
    const roomCode = "STALE-SUBMISSION-CALLBACK";
    const room = { code: roomCode, status: "starting", selectedRoundCount: 5, players };
    const started = gameManager.startGame(room, "fact-or-cap");
    context.after(() => gameManager.removeGame(roomCode, started.sessionId));
    const sessionId = started.sessionId;
    const previousRoundId = started.state.roundId;

    gameManager.performGameAction(roomCode, "fact-or-cap", null, "open-submissions", { roundId: previousRoundId }, undefined, sessionId);
    for (const player of players) {
        gameManager.performGameAction(roomCode, "fact-or-cap", player.id, "submit-completion", `answer ${player.id}`, player.id, sessionId);
    }
    gameManager.performGameAction(roomCode, "fact-or-cap", null, "begin-voting", undefined, undefined, sessionId);
    for (const player of players) {
        const ownState = gameManager.getPublicGameState(roomCode, player.id);
        const option = ownState.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
        assert.ok(option);
        gameManager.performGameAction(roomCode, "fact-or-cap", player.id, "vote", option.id, player.id, sessionId);
    }
    gameManager.performGameAction(roomCode, "fact-or-cap", null, "publish-results", undefined, undefined, sessionId);
    for (const player of players) gameManager.performGameAction(roomCode, "fact-or-cap", player.id, "continue", undefined, player.id, sessionId);
    const nextRound = gameManager.getPublicGameState(roomCode, players[0].id);
    assert.equal(nextRound.state.phase, "question");
    assert.notEqual(nextRound.state.roundId, previousRoundId);

    const broadcasts = [];
    const io = { to: () => ({ emit: (...args) => broadcasts.push(args) }) };
    const staleRoundCallback = captureSubmissionCallback(io, roomCode, sessionId, previousRoundId);
    const currentCallback = captureSubmissionCallback(io, roomCode, sessionId, nextRound.state.roundId);
    const duplicateCallback = captureSubmissionCallback(io, roomCode, sessionId, nextRound.state.roundId);

    staleRoundCallback();
    assert.deepEqual(broadcasts, []);
    currentCallback();
    duplicateCallback();

    const afterCallbacks = gameManager.getPublicGameState(roomCode, players[0].id);
    assert.equal(afterCallbacks.state.phase, "answer-submission");
    assert.equal(afterCallbacks.sessionId, sessionId);
    assert.equal(afterCallbacks.state.roundId, nextRound.state.roundId);
    assert.equal(broadcasts.length, 1, "only the first callback may broadcast the phase transition");

    const replacementRoom = {
        code: roomCode,
        status: "starting",
        selectedRoundCount: 5,
        players
    };
    gameManager.removeGame(roomCode, sessionId);
    const replacement = gameManager.startGame(replacementRoom, "fact-or-cap");
    context.after(() => gameManager.removeGame(roomCode, replacement.sessionId));
    const replacementCallback = captureSubmissionCallback(
        io,
        roomCode,
        sessionId,
        replacement.state.roundId
    );
    replacementCallback();
    assert.equal(gameManager.getPublicGameState(roomCode, players[0].id).sessionId, replacement.sessionId);
    assert.equal(gameManager.getPublicGameState(roomCode, players[0].id).state.phase, "question");
    assert.equal(broadcasts.length, 1);

    const cleanedRoomCode = `${roomCode}-CLEANED`;
    const cleanedRoom = { ...replacementRoom, code: cleanedRoomCode };
    const cleaned = gameManager.startGame(cleanedRoom, "fact-or-cap");
    const cleanupCallback = captureSubmissionCallback(
        io,
        cleanedRoomCode,
        cleaned.sessionId,
        cleaned.state.roundId
    );
    assert.equal(gameManager.removeGame(cleanedRoomCode, cleaned.sessionId), true);
    cleanupCallback();
    assert.throws(() => gameManager.getPublicGameState(cleanedRoomCode, players[0].id), {
        code: "GAME_NOT_ACTIVE"
    });
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

test("two departures immediately around results publication preserve the one published snapshot", () => {
    const fourPlayers = [...players, { id: "d", name: "D" }];
    for (const game of fakeGames) {
        const state = readyFakeForVoting(game, fourPlayers);
        const correct = state.options.find(({ correct: isCorrect }) => isCorrect);
        for (const player of fourPlayers) game.handleAction(state, "vote", player.id, correct.id);
        assert.equal(state.phase, "waiting-for-results");
        game.removeParticipant(state, "d");
        assert.equal(state.phase, "results");
        const results = JSON.stringify(state.results);
        const scores = JSON.stringify([...state.scores]);
        const statistics = JSON.stringify([...state.statistics]);
        game.removeParticipant(state, "c");
        assert.equal(state.phase, "results");
        assert.equal(JSON.stringify(state.results), results);
        assert.equal(JSON.stringify([...state.scores]), scores);
        assert.equal(JSON.stringify([...state.statistics]), statistics);
        assert.equal(state.results.players.length, 4);
        assert.deepEqual(state.participants.map(({ id }) => id), ["a", "b"]);
    }

    const state = readyBruhForVoting(fourPlayers);
    for (const player of fourPlayers) {
        bruh.handleAction(state, "vote", player.id, state.options.find(({ authorId }) => authorId !== player.id).id);
    }
    assert.equal(state.phase, "waiting-for-results");
    bruh.removeParticipant(state, "d");
    assert.equal(state.phase, "results");
    const results = JSON.stringify(state.results);
    const scores = JSON.stringify([...state.scores]);
    bruh.removeParticipant(state, "c");
    assert.equal(state.phase, "results");
    assert.equal(JSON.stringify(state.results), results);
    assert.equal(JSON.stringify([...state.scores]), scores);
    assert.equal(state.results.answers.length, 4);
    assert.deepEqual(state.participants.map(({ id }) => id), ["a", "b"]);
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
