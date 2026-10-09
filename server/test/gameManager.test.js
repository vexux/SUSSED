const assert = require("node:assert/strict");
const test = require("node:test");
const gameManager = require("../gameManager");
const gameRegistry = require("../gameRegistry");
const fakeAnswer = require("../games/fake-answer/game");
const { questions } = require("../games/fake-answer/questionBank");

function createStartingRoom(playerCount = 4) {
    return {
        code: "TEST",
        status: "starting",
        players: Array.from({ length: playerCount }, (_, index) => ({
            id: `player-${index + 1}`,
            name: `Player ${index + 1}`
        }))
    };
}

test("registry resolves the fake-answer implementation by its game ID", () => {
    assert.equal(gameRegistry.get("fake-answer"), fakeAnswer);
    assert.equal(fakeAnswer.id, "fake-answer");
    assert.equal(fakeAnswer.displayName, "Fake Answer");
});

test("rejects unregistered game IDs", () => {
    assert.throws(
        () => gameManager.getGameDefinition("not-registered"),
        { code: "GAME_NOT_FOUND" }
    );
});

test("generic game sessions start registered games and expose only public state", () => {
    const room = createStartingRoom();
    const publicState = gameManager.startGame(room, "fake-answer");
    const privateState = fakeAnswer.start(
        fakeAnswer.createInitialState(room.players)
    );
    const publicQuestion = questions.find(
        (question) => question.id === publicState.state.prompt.id
    );
    const moduleState = fakeAnswer.createPublicState(privateState);

    try {
        assert.equal(publicState.gameId, "fake-answer");
        assert.equal(publicState.status, "active");
        assert.equal(publicState.displayName, fakeAnswer.displayName);
        assert.equal(publicState.state.phase, "question");
        assert.equal(publicState.state.currentRound, 1);
        assert.equal(publicState.state.totalRounds, 5);
        assert.ok(publicQuestion);
        assert.equal(moduleState.prompt.id, privateState.currentQuestion.id);
        assert.equal(
            JSON.stringify(publicState).includes(publicQuestion.correctCompletion),
            false
        );
        assert.equal(Object.hasOwn(publicState.state.prompt, "correctCompletion"), false);
        assert.equal(Object.hasOwn(publicState, "implementation"), false);
        assert.equal(typeof privateState.currentQuestion.correctCompletion, "string");
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("fake-answer can move from question to answer-submission and then reveal", () => {
    const room = createStartingRoom();
    gameManager.startGame(room, "fake-answer");
    assert.throws(
        () => gameManager.performGameAction(
            room.code,
            "fake-answer",
            "player-1",
            "submit-completion",
            "Too early"
        ),
        { code: "SUBMISSIONS_NOT_OPEN" }
    );
    const initial = gameManager.performGameAction(
        room.code,
        "fake-answer",
        null,
        "open-submissions"
    );

    assert.equal(initial.gameState.state.phase, "answer-submission");
    assert.equal(initial.gameState.state.submissionCount, 0);
    let finalState;
    for (const player of room.players) {
        finalState = gameManager.performGameAction(
            room.code,
            "fake-answer",
            player.id,
            "submit-completion",
            `Invented completion by ${player.name}`
        );
    }

    assert.equal(finalState.gameState.state.phase, "reveal");
    gameManager.removeGame(room.code);
});

test("fake-answer supports every player count within the room capacity", () => {
    assert.deepEqual(fakeAnswer.supportedPlayers, { min: 2, max: 8 });
    for (const playerCount of [2, 3, 4, 5, 6, 7, 8]) {
        assert.equal(gameManager.isPlayerCountSupported(fakeAnswer, playerCount), true);
        const room = createStartingRoom(playerCount);
        const publicState = gameManager.startGame(room, "fake-answer");
        try {
            assert.equal(publicState.players.length, playerCount);
            assert.equal(publicState.state.playerCount, playerCount);
        } finally {
            gameManager.removeGame(room.code);
        }
    }
    assert.equal(gameManager.isPlayerCountSupported(fakeAnswer, 1), false);
    assert.equal(gameManager.isPlayerCountSupported(fakeAnswer, 9), false);

    for (const playerCount of [1, 9]) {
        const lobbyRoom = {
            ...createStartingRoom(playerCount),
            status: "lobby"
        };
        assert.throws(
            () => gameManager.validateGameStart(lobbyRoom, "fake-answer"),
            { code: "UNSUPPORTED_PLAYER_COUNT" }
        );
        assert.throws(
            () => gameManager.startGame(createStartingRoom(playerCount), "fake-answer"),
            { code: "UNSUPPORTED_PLAYER_COUNT" }
        );
    }

    const futureGame = { supportedPlayers: { min: 2, max: 6 } };
    assert.equal(gameManager.isPlayerCountSupported(futureGame, 6), true);
    assert.equal(gameManager.isPlayerCountSupported(futureGame, 7), false);
});

test("two-player fake-answer game reaches reveal after both players submit once", () => {
    const room = createStartingRoom(2);
    const initialState = gameManager.startGame(room, "fake-answer");

    try {
        assert.equal(initialState.state.phase, "question");
        assert.equal(initialState.state.playerCount, 2);
        const question = questions.find(({ id }) => id === initialState.state.prompt.id);
        assert.ok(question);
        assert.equal(JSON.stringify(initialState).includes(question.correctCompletion), false);

        gameManager.performGameAction(
            room.code,
            "fake-answer",
            null,
            "open-submissions"
        );
        const firstSubmission = gameManager.performGameAction(
            room.code,
            "fake-answer",
            "player-1",
            "submit-completion",
            "A tiny orchestra performs inside."
        );
        assert.equal(firstSubmission.gameState.state.submissionCount, 1);
        assert.equal(firstSubmission.gameState.state.playerCount, 2);
        assert.equal(firstSubmission.gameState.state.phase, "answer-submission");
        assert.equal(
            JSON.stringify(firstSubmission.gameState).includes(question.correctCompletion),
            false
        );
        assert.throws(
            () => gameManager.performGameAction(
                room.code,
                "fake-answer",
                "player-1",
                "submit-completion",
                "A second invented answer."
            ),
            { code: "ALREADY_SUBMITTED" }
        );

        const finalSubmission = gameManager.performGameAction(
            room.code,
            "fake-answer",
            "player-2",
            "submit-completion",
            "It opens only at midnight."
        );
        assert.equal(finalSubmission.gameState.state.phase, "reveal");
        assert.equal(finalSubmission.gameState.state.submissionCount, 2);
        assert.equal(finalSubmission.gameState.state.prompt, null);
        assert.equal(
            JSON.stringify(finalSubmission.gameState).includes(question.correctCompletion),
            false
        );
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("question bank contains at least 15 unique sourced prompts", () => {
    assert.ok(questions.length >= 15);
    assert.equal(new Set(questions.map(({ id }) => id)).size, questions.length);
    for (const question of questions) {
        assert.ok(question.id);
        assert.ok(question.text);
        assert.ok(question.correctCompletion);
        assert.ok(question.sourceName);
        assert.match(question.sourceUrl, /^https:\/\//);
    }
});
