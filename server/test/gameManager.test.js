const assert = require("node:assert/strict");
const test = require("node:test");
const gameManager = require("../gameManager");
const gameRegistry = require("../gameRegistry");
const fakeAnswer = require("../games/fake-answer/game");
const { questions } = require("../games/fake-answer/questionBank");

function createStartingRoom() {
    return {
        code: "TEST",
        status: "starting",
        players: Array.from({ length: 4 }, (_, index) => ({
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

test("fake-answer owns a four-player requirement without imposing it on other games", () => {
    assert.deepEqual(fakeAnswer.supportedPlayers, { min: 4, max: 4 });
    assert.equal(gameManager.isPlayerCountSupported(fakeAnswer, 4), true);
    assert.equal(gameManager.isPlayerCountSupported(fakeAnswer, 3), false);

    const futureGame = { supportedPlayers: { min: 2, max: 6 } };
    assert.equal(gameManager.isPlayerCountSupported(futureGame, 6), true);
    assert.equal(gameManager.isPlayerCountSupported(futureGame, 7), false);
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
