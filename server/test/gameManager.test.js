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

test("fake-answer reveals options and enters voting after every participant submits", () => {
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
    assert.equal(finalState.gameState.state.options.length, room.players.length);
    const selectedQuestion = questions.find(
        ({ id }) => id === finalState.gameState.state.prompt.id
    );
    assert.ok(selectedQuestion);
    assert.ok(
        finalState.gameState.state.options.some(
            ({ completion }) => completion === selectedQuestion.correctCompletion
        )
    );
    assert.ok(
        finalState.gameState.state.options.every(
            (option) => Object.keys(option).sort().join(",") === "completion,id"
        )
    );

    const playerTwoRevealOptions = gameManager.getPublicGameState(
        room.code,
        "player-2"
    ).state.options;
    const ownAnswerId = playerTwoRevealOptions.find(
        ({ completion }) => completion === "Invented completion by Player 1"
    ).id;
    assert.throws(
        () => gameManager.performGameAction(
            room.code,
            "fake-answer",
            "player-1",
            "vote",
            ownAnswerId
        ),
        { code: "VOTING_NOT_OPEN" }
    );
    gameManager.performGameAction(
        room.code,
        "fake-answer",
        null,
        "begin-voting"
    );
    const selectedOptions = gameManager.getPublicGameState(room.code, "player-1").state.options;
    assert.equal(
        selectedOptions.some(({ completion }) => completion === selectedQuestion.correctCompletion),
        true
    );
    const playerOneOptions = gameManager.getPublicGameState(room.code, "player-1").state.options;
    const playerTwoOptions = gameManager.getPublicGameState(room.code, "player-2").state.options;
    assert.equal(playerOneOptions.length, room.players.length);
    assert.equal(playerOneOptions.some(({ id }) => id === ownAnswerId), false);
    assert.equal(
        playerOneOptions.some(
            ({ completion }) => completion === "Invented completion by Player 1"
        ),
        false
    );
    assert.equal(playerTwoOptions.length, room.players.length);
    assert.ok(
        playerOneOptions.every(
            (option) => !("authorId" in option) && !("correct" in option)
        )
    );

    const ownOption = finalState.gameState.state.options.find(
        ({ completion }) => completion === "Invented completion by Player 1"
    );
    assert.throws(
        () => gameManager.performGameAction(
            room.code,
            "fake-answer",
            "player-1",
            "vote",
            ownOption.id
        ),
        { code: "OWN_ANSWER_NOT_ALLOWED" }
    );
    const voteOption = playerOneOptions[0];
    const vote = gameManager.performGameAction(
        room.code,
        "fake-answer",
        "player-1",
        "vote",
        voteOption.id
    );
    assert.equal(vote.gameState.state.phase, "voting");
    assert.equal(vote.gameState.state.voteCount, 1);
    assert.equal(Object.hasOwn(vote.gameState.state, "votes"), false);
    assert.throws(
        () => gameManager.performGameAction(
            room.code,
            "fake-answer",
            "player-1",
            "vote",
            voteOption.id
        ),
        { code: "ALREADY_VOTED" }
    );

    let resultsState;
    for (const player of room.players.slice(1)) {
        const options = gameManager.getPublicGameState(room.code, player.id).state.options;
        resultsState = gameManager.performGameAction(
            room.code,
            "fake-answer",
            player.id,
            "vote",
            options[0].id
        );
    }
    assert.equal(resultsState.gameState.state.phase, "waiting-for-results");
    assert.equal(resultsState.gameState.state.voteCount, room.players.length);
    assert.equal(Object.hasOwn(resultsState.gameState.state, "options"), false);
    assert.equal(Object.hasOwn(resultsState.gameState.state, "votes"), false);
    assert.equal(
        JSON.stringify(resultsState.gameState).includes(selectedQuestion.correctCompletion),
        false
    );
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

test("fake-answer randomizes anonymous option order with opaque round IDs", () => {
    const correctPositions = new Set();

    for (let trial = 0; trial < 24; trial += 1) {
        const players = [
            { id: "first", name: "First" },
            { id: "second", name: "Second" }
        ];
        let state = fakeAnswer.start(fakeAnswer.createInitialState(players));
        fakeAnswer.handleAction(state, "open-submissions");
        fakeAnswer.handleAction(state, "submit-completion", "first", "Fake one");
        fakeAnswer.handleAction(state, "submit-completion", "second", "Fake two");

        const correctIndex = state.options.findIndex(({ correct }) => correct);
        correctPositions.add(correctIndex);
        assert.equal(state.options.length, 3);
        assert.equal(
            new Set(state.options.map(({ id }) => id)).size,
            state.options.length
        );
        assert.ok(state.options.every(({ id }) => /^[0-9a-f-]{36}$/i.test(id)));
        assert.ok(state.options.every(({ correct }) => typeof correct === "boolean"));
    }

    assert.ok(correctPositions.size > 1, "the correct option position should be randomized");
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
        assert.deepEqual(finalSubmission.gameState.state.prompt, {
            id: question.id,
            text: question.text
        });
        assert.equal(finalSubmission.gameState.state.options.length, 2);
        assert.equal(
            finalSubmission.gameState.state.options.some(
                ({ completion }) => completion === question.correctCompletion
            ),
            true
        );
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("fake-answer voting supports every player count from two through eight", () => {
    for (const playerCount of [2, 3, 4, 5, 6, 7, 8]) {
        const room = createStartingRoom(playerCount);
        gameManager.startGame(room, "fake-answer");
        try {
            gameManager.performGameAction(
                room.code,
                "fake-answer",
                null,
                "open-submissions"
            );
            for (const player of room.players) {
                gameManager.performGameAction(
                    room.code,
                    "fake-answer",
                    player.id,
                    "submit-completion",
                    `Invented answer for ${player.id}`
                );
            }
            gameManager.performGameAction(
                room.code,
                "fake-answer",
                null,
                "begin-voting"
            );

            let finalVote;
            for (const player of room.players) {
                const publicState = gameManager.getPublicGameState(room.code, player.id);
                assert.equal(publicState.state.options.length, playerCount);
                assert.equal(
                    publicState.state.options.some(
                        ({ completion }) => completion === `Invented answer for ${player.id}`
                    ),
                    false
                );
                assert.ok(
                    publicState.state.options.every(
                        (option) =>
                            typeof option.id === "string" &&
                            Object.keys(option).sort().join(",") === "completion,id"
                    )
                );
                finalVote = gameManager.performGameAction(
                    room.code,
                    "fake-answer",
                    player.id,
                    "vote",
                    publicState.state.options[0].id
                );
            }
            assert.equal(finalVote.gameState.state.phase, "waiting-for-results");
            assert.equal(finalVote.gameState.state.voteCount, playerCount);
        } finally {
            gameManager.removeGame(room.code);
        }
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
