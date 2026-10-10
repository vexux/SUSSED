const assert = require("node:assert/strict");
const test = require("node:test");
const gameManager = require("../gameManager");
const gameRegistry = require("../gameRegistry");
const fakeAnswer = require("../games/fake-answer/game");
const factOrCapAnime = require("../games/fake-answer/anime");
const { questions: animeQuestions } = require("../games/fake-answer/animeQuestionBank");
const {
    questions,
    selectQuestionOrder,
} = require("../games/fake-answer/questionBank");

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

function createFakeAnswerVotingState(playerCount) {
    const players = Array.from({ length: playerCount }, (_, index) => ({
        id: `scorer-${index + 1}`,
        name: `Scorer ${index + 1}`
    }));
    let state = fakeAnswer.start(fakeAnswer.createInitialState(players));
    fakeAnswer.handleAction(state, "open-submissions");
    for (const player of players) {
        fakeAnswer.handleAction(
            state,
            "submit-completion",
            player.id,
            `Invented completion by ${player.name}`
        );
    }
    fakeAnswer.handleAction(state, "begin-voting");
    return { players, state };
}

function submitFakeAnswerVote(state, playerId, selector) {
    const option = selector(state.options);
    fakeAnswer.handleAction(state, "vote", playerId, option.id);
    return option;
}

function completeManagedRound(room, selectCompletion) {
    const gameId = "fact-or-cap";
    const questionState = gameManager.getPublicGameState(
        room.code,
        room.players[0].id
    );
    const round = questionState.state.currentRound;
    gameManager.performGameAction(room.code, gameId, null, "open-submissions");
    for (const player of room.players) {
        gameManager.performGameAction(
            room.code,
            gameId,
            player.id,
            "submit-completion",
            `Private bluff ${round} from ${player.id}`
        );
    }
    gameManager.performGameAction(room.code, gameId, null, "begin-voting");
    const question = questions.find(
        ({ text }) => text === questionState.state.prompt.text
    );
    assert.ok(question);
    for (const player of room.players) {
        const options = gameManager.getPublicGameState(room.code, player.id).state.options;
        const completion = selectCompletion(player, round, question.correctCompletion);
        const option = options.find(({ completion: answer }) => answer === completion);
        assert.ok(option, `expected an eligible option for ${player.id}`);
        gameManager.performGameAction(
            room.code,
            gameId,
            player.id,
            "vote",
            option.id
        );
    }
    return gameManager.performGameAction(
        room.code,
        gameId,
        null,
        "publish-results"
    ).gameState;
}

function completeManagedGame(room, selectCompletion) {
    let result;
    for (let round = 1; round <= 5; round += 1) {
        result = completeManagedRound(room, selectCompletion);
        if (round < 5) {
            for (const player of room.players) {
                gameManager.performGameAction(
                    room.code,
                    "fact-or-cap",
                    player.id,
                    "continue"
                );
            }
        }
    }
    return result;
}

test("registry resolves the fake-answer implementation by its game ID", () => {
    assert.equal(gameRegistry.get("fact-or-cap"), fakeAnswer);
    assert.equal(fakeAnswer.id, "fact-or-cap");
    assert.equal(fakeAnswer.displayName, "Fact or Cap");
});

test("both registered identities share the same engine and use isolated question banks", () => {
    assert.deepEqual(gameRegistry.list().map(({ id, displayName }) => ({ id, displayName })), [
        { id: "fact-or-cap", displayName: "Fact or Cap" },
        { id: "fact-or-cap-anime", displayName: "Fact or Cap (Anime)" }
    ]);
    assert.equal(factOrCapAnime.createInitialState, fakeAnswer.createInitialState);
    assert.equal(factOrCapAnime.handleAction, fakeAnswer.handleAction);
    assert.equal(factOrCapAnime.calculateRoundResults, fakeAnswer.calculateRoundResults);
    assert.equal(factOrCapAnime.supportedPlayers.min, 2);
    assert.equal(factOrCapAnime.supportedPlayers.max, 8);
    assert.equal(animeQuestions.length, 5);
    assert.equal(questions.length, 20);
    assert.equal(
        questions.some(({ id }) => animeQuestions.some((animeQuestion) => animeQuestion.id === id)),
        false
    );
    assert.equal(
        questions.some(({ text, correctCompletion }) =>
            animeQuestions.some((animeQuestion) =>
                animeQuestion.text === text &&
                animeQuestion.correctCompletion === correctCompletion
            )
        ),
        false
    );
});

test("rejects unregistered game IDs", () => {
    assert.throws(
        () => gameManager.getGameDefinition("not-registered"),
        { code: "GAME_NOT_FOUND" }
    );
});

test("generic game sessions start registered games and expose only public state", () => {
    const room = createStartingRoom();
    const publicState = gameManager.startGame(room, "fact-or-cap");
    const privateState = fakeAnswer.start(
        fakeAnswer.createInitialState(room.players)
    );
    const publicQuestion = questions.find(
        (question) => question.text === publicState.state.prompt.text
    );
    const moduleState = fakeAnswer.createPublicState(privateState);

    try {
        assert.equal(publicState.gameId, "fact-or-cap");
        assert.match(publicState.sessionId, /^[0-9a-f-]{36}$/i);
        assert.equal(publicState.status, "active");
        assert.equal(publicState.displayName, fakeAnswer.displayName);
        assert.equal(publicState.state.phase, "question");
        assert.equal(publicState.state.currentRound, 1);
        assert.equal(publicState.state.totalRounds, 5);
        assert.ok(publicQuestion);
        assert.equal(moduleState.prompt.id, privateState.roundId);
        assert.notEqual(moduleState.prompt.id, privateState.currentQuestion.id);
        assert.equal(
            JSON.stringify(publicState).includes(publicQuestion.correctCompletion),
            false
        );
        assert.equal(
            JSON.stringify(publicState).includes(publicQuestion.sourceName),
            false
        );
        assert.equal(
            JSON.stringify(publicState).includes(publicQuestion.sourceUrl),
            false
        );
        assert.equal(Object.hasOwn(publicState.state.prompt, "correctCompletion"), false);
        assert.equal(Object.hasOwn(publicState, "implementation"), false);
        assert.equal(typeof privateState.currentQuestion.correctCompletion, "string");
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("Anime sessions initialize from their own sourced pool and keep source metadata private", () => {
    const room = createStartingRoom(2);
    const publicState = gameManager.startGame(room, "fact-or-cap-anime");
    const selectedQuestion = animeQuestions.find(
        ({ text }) => text === publicState.state.prompt.text
    );
    try {
        assert.equal(publicState.gameId, "fact-or-cap-anime");
        assert.equal(publicState.displayName, "Fact or Cap (Anime)");
        assert.ok(selectedQuestion);
        assert.equal(questions.some(({ id }) => id === selectedQuestion.id), false);
        assert.equal(
            JSON.stringify(publicState).includes(selectedQuestion.correctCompletion),
            false
        );
        assert.equal(JSON.stringify(publicState).includes(selectedQuestion.sourceUrl), false);
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("generic game manager retires only finished sessions", () => {
    const room = createStartingRoom(2);
    gameManager.startGame(room, "fact-or-cap");
    try {
        assert.throws(
            () => gameManager.retireFinishedGame(room.code),
            { code: "GAME_NOT_FINISHED" }
        );
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("retired session IDs cannot act on or remove a replacement session", () => {
    const room = createStartingRoom(2);
    const first = gameManager.startGame(room, "fact-or-cap");
    assert.throws(
        () => gameManager.startGame(room, "fact-or-cap"),
        { code: "GAME_ALREADY_STARTED" }
    );
    assert.equal(gameManager.abortActiveGame(room.code), true);
    const second = gameManager.startGame(room, "fact-or-cap");

    try {
        assert.notEqual(first.sessionId, second.sessionId);
        assert.throws(
            () => gameManager.performGameAction(
                room.code,
                "fact-or-cap",
                null,
                "open-submissions",
                undefined,
                undefined,
                first.sessionId
            ),
            { code: "SESSION_MISMATCH" }
        );
        assert.equal(gameManager.removeGame(room.code, first.sessionId), false);
        assert.equal(
            gameManager.getPublicGameState(room.code, room.players[0].id).sessionId,
            second.sessionId
        );
    } finally {
        gameManager.removeGame(room.code, second.sessionId);
    }
});

test("fake-answer reveals anonymous options, marks own answer, and enters voting after all submit", () => {
    const room = createStartingRoom();
    gameManager.startGame(room, "fact-or-cap");
    assert.throws(
        () => gameManager.performGameAction(
            room.code,
            "fact-or-cap",
            "player-1",
            "submit-completion",
            "Too early"
        ),
        { code: "SUBMISSIONS_NOT_OPEN" }
    );
    const initial = gameManager.performGameAction(
        room.code,
        "fact-or-cap",
        null,
        "open-submissions"
    );

    assert.equal(initial.gameState.state.phase, "answer-submission");
    assert.equal(initial.gameState.state.submissionCount, 0);
    let finalState;
    for (const player of room.players) {
        finalState = gameManager.performGameAction(
            room.code,
            "fact-or-cap",
            player.id,
            "submit-completion",
            `Invented completion by ${player.name}`
        );
    }

    assert.equal(finalState.gameState.state.phase, "reveal");
    assert.equal(finalState.gameState.state.options.length, room.players.length + 1);
    const selectedQuestion = questions.find(
        ({ text }) => text === finalState.gameState.state.prompt.text
    );
    assert.ok(selectedQuestion);
    assert.ok(
        finalState.gameState.state.options.some(
            ({ completion }) =>
                completion === selectedQuestion.correctCompletion
        )
    );
    assert.ok(
        finalState.gameState.state.options.every(
            (option) =>
                Object.keys(option).sort().join(",") === "completion,id,isOwnAnswer"
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
            "fact-or-cap",
            "player-1",
            "vote",
            ownAnswerId
        ),
        { code: "VOTING_NOT_OPEN" }
    );
    gameManager.performGameAction(
        room.code,
        "fact-or-cap",
        null,
        "begin-voting"
    );
    const selectedOptions = gameManager.getPublicGameState(room.code, "player-1").state.options;
    assert.equal(
        selectedOptions.some(({ completion }) =>
            completion === selectedQuestion.correctCompletion
        ),
        true
    );
    const playerOneOptions = gameManager.getPublicGameState(room.code, "player-1").state.options;
    const playerTwoOptions = gameManager.getPublicGameState(room.code, "player-2").state.options;
    assert.equal(playerOneOptions.length, room.players.length + 1);
    assert.equal(playerTwoOptions.length, room.players.length + 1);
    assert.equal(
        playerOneOptions.find(({ id }) => id === ownAnswerId).isOwnAnswer,
        true
    );
    assert.equal(
        playerOneOptions.find(
            ({ completion }) => completion === "Invented completion by Player 1"
        ).isOwnAnswer,
        true
    );
    assert.equal(
        playerTwoOptions.filter(({ isOwnAnswer }) => isOwnAnswer).length,
        1
    );
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
            "fact-or-cap",
            "player-1",
            "vote",
            ownOption.id
        ),
        { code: "OWN_ANSWER_NOT_ALLOWED" }
    );
    const voteOption = playerOneOptions.find(({ isOwnAnswer }) => !isOwnAnswer);
    const vote = gameManager.performGameAction(
        room.code,
        "fact-or-cap",
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
            "fact-or-cap",
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
            "fact-or-cap",
            player.id,
            "vote",
            options.find(({ isOwnAnswer }) => !isOwnAnswer).id
        );
    }
    assert.equal(resultsState.gameState.state.phase, "waiting-for-results");
    assert.equal(resultsState.gameState.state.voteCount, room.players.length);
    assert.equal(Object.hasOwn(resultsState.gameState.state, "options"), false);
    assert.equal(Object.hasOwn(resultsState.gameState.state, "votes"), false);
    assert.equal(
        JSON.stringify(resultsState.gameState).includes(
            selectedQuestion.correctCompletion
        ),
        false
    );
    gameManager.removeGame(room.code);
});

test("fake-answer supports every player count within the room capacity", () => {
    assert.deepEqual(fakeAnswer.supportedPlayers, { min: 2, max: 8 });
    for (const playerCount of [2, 3, 4, 5, 6, 7, 8]) {
        assert.equal(gameManager.isPlayerCountSupported(fakeAnswer, playerCount), true);
        const room = createStartingRoom(playerCount);
        const publicState = gameManager.startGame(room, "fact-or-cap");
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
            () => gameManager.validateGameStart(lobbyRoom, "fact-or-cap"),
            { code: "UNSUPPORTED_PLAYER_COUNT" }
        );
        assert.throws(
            () => gameManager.startGame(createStartingRoom(playerCount), "fact-or-cap"),
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
    const initialState = gameManager.startGame(room, "fact-or-cap");

    try {
        assert.equal(initialState.state.phase, "question");
        assert.equal(initialState.state.playerCount, 2);
        const question = questions.find(
            ({ text }) => text === initialState.state.prompt.text
        );
        assert.ok(question);
        assert.equal(JSON.stringify(initialState).includes(question.correctCompletion), false);

        gameManager.performGameAction(
            room.code,
            "fact-or-cap",
            null,
            "open-submissions"
        );
        const firstSubmission = gameManager.performGameAction(
            room.code,
            "fact-or-cap",
            "player-1",
            "submit-completion",
            "A tiny orchestra performs inside."
        );
        assert.equal(firstSubmission.gameState.state.submissionCount, 1);
        assert.equal(firstSubmission.gameState.state.playerCount, 2);
        assert.equal(firstSubmission.gameState.state.phase, "answer-submission");
        assert.equal(
            JSON.stringify(firstSubmission.gameState).includes(
                question.correctCompletion
            ),
            false
        );
        assert.throws(
            () => gameManager.performGameAction(
                room.code,
                "fact-or-cap",
                "player-1",
                "submit-completion",
                "A second invented answer."
            ),
            { code: "ALREADY_SUBMITTED" }
        );

        const finalSubmission = gameManager.performGameAction(
            room.code,
            "fact-or-cap",
            "player-2",
            "submit-completion",
            "It opens only at midnight."
        );
        assert.equal(finalSubmission.gameState.state.phase, "reveal");
        assert.equal(finalSubmission.gameState.state.submissionCount, 2);
        assert.deepEqual(finalSubmission.gameState.state.prompt, {
            id: finalSubmission.gameState.state.roundId,
            text: question.text
        });
        assert.equal(finalSubmission.gameState.state.options.length, 3);
        assert.equal(
            finalSubmission.gameState.state.options.some(
                ({ completion }) =>
                    completion === question.correctCompletion
            ),
            true
        );
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("duplicate submissions share a private error and do not change submission progress", () => {
    const players = [
        { id: "duplicate-player-1", name: "First" },
        { id: "duplicate-player-2", name: "Second" }
    ];
    const state = fakeAnswer.start(fakeAnswer.createInitialState(players));
    fakeAnswer.handleAction(state, "open-submissions");

    function captureError(completion, playerId) {
        let capturedError;
        try {
            fakeAnswer.handleAction(state, "submit-completion", playerId, completion);
        } catch (error) {
            capturedError = error;
        }
        assert.ok(capturedError, "Expected duplicate completion to be rejected.");
        return { code: capturedError.code, message: capturedError.message };
    }

    const correctAnswer = state.currentQuestion.correctCompletion;
    const correctDuplicate = captureError(
        `  ${correctAnswer.normalize("NFKC").toUpperCase().replace(/\s+/gu, "   ")} `,
        players[0].id
    );
    assert.deepEqual(correctDuplicate, {
        code: "DUPLICATE_ANSWER",
        message: "Duplicate answer. Please submit a different completion."
    });
    assert.equal(correctDuplicate.message.includes(correctAnswer), false);

    fakeAnswer.handleAction(
        state,
        "submit-completion",
        players[0].id,
        "A  separate   completion!"
    );
    const anotherPlayerDuplicate = captureError(
        "  a separate completion!  ",
        players[1].id
    );
    assert.deepEqual(anotherPlayerDuplicate, correctDuplicate);
    assert.equal(state.submissions.size, 1);
    assert.equal(state.submissionStatus.get(players[1].id), false);
    assert.equal(state.phase, "answer-submission");

    assert.deepEqual(
        fakeAnswer.handleAction(
            state,
            "submit-completion",
            players[1].id,
            "A separate completion?"
        ),
        { submitted: true, submissionCount: 2, playerCount: 2 }
    );
    assert.equal(state.phase, "reveal");
});

test("fake-answer voting supports every player count from two through eight", () => {
    for (const playerCount of [2, 3, 4, 5, 6, 7, 8]) {
        const room = createStartingRoom(playerCount);
        gameManager.startGame(room, "fact-or-cap");
        try {
            gameManager.performGameAction(
                room.code,
                "fact-or-cap",
                null,
                "open-submissions"
            );
            for (const player of room.players) {
                gameManager.performGameAction(
                    room.code,
                    "fact-or-cap",
                    player.id,
                    "submit-completion",
                    `Invented answer for ${player.id}`
                );
            }
            gameManager.performGameAction(
                room.code,
                "fact-or-cap",
                null,
                "begin-voting"
            );

            let finalVote;
            for (const player of room.players) {
                const publicState = gameManager.getPublicGameState(room.code, player.id);
                assert.equal(publicState.state.options.length, playerCount + 1);
                assert.equal(
                    publicState.state.options.find(
                        ({ completion }) =>
                            completion === `Invented answer for ${player.id}`
                    ).isOwnAnswer,
                    true
                );
                assert.ok(
                    publicState.state.options.every(
                        (option) =>
                            typeof option.id === "string" &&
                            typeof option.isOwnAnswer === "boolean" &&
                            Object.keys(option).sort().join(",") ===
                                "completion,id,isOwnAnswer"
                    )
                );
                finalVote = gameManager.performGameAction(
                    room.code,
                    "fact-or-cap",
                    player.id,
                    "vote",
                    publicState.state.options.find(
                        ({ isOwnAnswer }) => !isOwnAnswer
                    ).id
                );
            }
            assert.equal(finalVote.gameState.state.phase, "waiting-for-results");
            assert.equal(finalVote.gameState.state.voteCount, playerCount);
        } finally {
            gameManager.removeGame(room.code);
        }
    }
});

test("fake-answer scoring awards correct-vote and fake-answer points independently", () => {
    const { players, state } = createFakeAnswerVotingState(3);
    const realOption = state.options.find(({ correct }) => correct);
    const playerOneFake = state.options.find(
        ({ authorId }) => authorId === players[0].id
    );

    submitFakeAnswerVote(state, players[0].id, (options) =>
        options.find(({ correct }) => correct)
    );
    submitFakeAnswerVote(state, players[1].id, (options) =>
        options.find(({ authorId }) => authorId === players[0].id)
    );
    submitFakeAnswerVote(state, players[2].id, (options) =>
        options.find(({ authorId }) => authorId === players[0].id)
    );

    assert.equal(state.phase, "waiting-for-results");
    assert.equal(state.scores.get(players[0].id), 0);
    fakeAnswer.handleAction(state, "publish-results");
    assert.equal(state.phase, "results");
    assert.equal(state.results.players[0].voteOptionId, realOption.id);
    assert.equal(state.results.players[0].roundPoints, 4);
    assert.equal(state.results.players[0].correctVotePoints, 2);
    assert.equal(state.results.players[0].bluffPoints, 2);
    assert.equal(state.results.players[0].totalScore, 4);
    assert.equal(state.results.options.find(({ id }) => id === playerOneFake.id).authorId, players[0].id);
    assert.deepEqual(
        state.results.options.find(({ id }) => id === playerOneFake.id).voters.map(
            ({ playerId }) => playerId
        ),
        [players[1].id, players[2].id]
    );
    assert.deepEqual(
        state.results.options.find(({ id }) => id === realOption.id).voters.map(
            ({ playerId }) => playerId
        ),
        [players[0].id]
    );
    for (const player of state.results.players.slice(1)) {
        assert.equal(player.voteCorrect, false);
        assert.equal(player.correctVotePoints, 0);
        assert.equal(player.roundPoints, 0);
    }
});

test("fake-answer scoring handles 2, 3, 4, and 8 players with tied standings", () => {
    for (const playerCount of [2, 3, 4, 8]) {
        const { players, state } = createFakeAnswerVotingState(playerCount);
        for (const player of players) {
            submitFakeAnswerVote(state, player.id, (options) =>
                options.find(({ correct }) => correct)
            );
        }

        fakeAnswer.handleAction(state, "publish-results");
        assert.equal(state.results.players.length, playerCount);
        assert.ok(state.results.players.every(({ roundPoints, totalScore }) =>
            roundPoints === 2 && totalScore === 2
        ));
        assert.ok(state.results.standings.every(({ totalScore, rank }) =>
            totalScore === 2 && rank === 1
        ));
        assert.equal(
            state.results.options.filter(({ isCorrect, authorId }) =>
                isCorrect && authorId === null
            ).length,
            1
        );
    }
});

test("both game variants award two points for a correct vote through the shared mechanics", () => {
    for (const [index, gameId] of ["fact-or-cap", "fact-or-cap-anime"].entries()) {
        const room = createStartingRoom(2);
        room.code = `SCORE${index}`;
        gameManager.startGame(room, gameId);
        try {
            gameManager.performGameAction(room.code, gameId, null, "open-submissions");
            for (const player of room.players) {
                gameManager.performGameAction(
                    room.code,
                    gameId,
                    player.id,
                    "submit-completion",
                    `A unique bluff ${gameId} by ${player.id}`
                );
            }
            gameManager.performGameAction(room.code, gameId, null, "begin-voting");
            for (const player of room.players) {
                const options = gameManager.getPublicGameState(room.code, player.id).state.options;
                const sourceQuestions = gameId === "fact-or-cap-anime"
                    ? animeQuestions
                    : questions;
                const prompt = gameManager.getPublicGameState(room.code, player.id).state.prompt;
                const sourceQuestion = sourceQuestions.find(
                    ({ text }) => text === prompt.text
                );
                assert.ok(sourceQuestion);
                const correctOption = options.find(
                    ({ completion }) =>
                        completion === sourceQuestion.correctCompletion
                );
                assert.ok(correctOption);
                gameManager.performGameAction(
                    room.code,
                    gameId,
                    player.id,
                    "vote",
                    correctOption.id
                );
            }
            const finalVote = gameManager.performGameAction(
                room.code,
                gameId,
                null,
                "publish-results"
            ).gameState;
            assert.ok(finalVote.state.results.players.every(
                ({ correctVotePoints, bluffPoints, roundPoints }) =>
                    correctVotePoints === 2 && bluffPoints === 0 && roundPoints === 2
            ));
        } finally {
            gameManager.removeGame(room.code);
        }
    }
});

test("fake-answer incorrect votes only score when another player selects that fake", () => {
    const { players, state } = createFakeAnswerVotingState(2);
    submitFakeAnswerVote(state, players[0].id, (options) =>
        options.find(({ authorId }) => authorId === players[1].id)
    );
    submitFakeAnswerVote(state, players[1].id, (options) =>
        options.find(({ authorId }) => authorId === players[0].id)
    );

    const expectedResults = fakeAnswer.calculateRoundResults(state);
    assert.ok(expectedResults.players.every(({ voteCorrect, roundPoints }) =>
        !voteCorrect && roundPoints === 1
    ));
    assert.ok(expectedResults.players.every(({ correctVotePoints }) =>
        correctVotePoints === 0
    ));
    fakeAnswer.handleAction(state, "publish-results");
    assert.deepEqual(
        state.results.players.map(({ roundPoints }) => roundPoints),
        [1, 1]
    );
    assert.deepEqual(
        state.results.standings.map(({ rank }) => rank),
        [1, 1]
    );
});

test("fake-answer results and scores stay private until a single scoring publication", () => {
    const { players, state } = createFakeAnswerVotingState(2);
    submitFakeAnswerVote(state, players[0].id, (options) =>
        options.find(({ correct }) => correct)
    );
    submitFakeAnswerVote(state, players[1].id, (options) =>
        options.find(({ authorId }) => authorId === players[0].id)
    );

    const waitingState = fakeAnswer.createPublicState(state, players[0].id);
    assert.equal(waitingState.phase, "waiting-for-results");
    assert.equal(Object.hasOwn(waitingState, "results"), false);
    assert.equal(JSON.stringify(waitingState).includes(state.currentQuestion.correctCompletion), false);
    assert.deepEqual([...state.scores.values()], [0, 0]);

    const publicResults = fakeAnswer.handleAction(state, "publish-results");
    assert.deepEqual(publicResults, { published: true, currentRound: 1 });
    const resultsState = fakeAnswer.createPublicState(state, players[0].id);
    assert.equal(resultsState.phase, "results");
    assert.equal(
        resultsState.results.correctCompletion,
        state.currentQuestion.correctCompletion
    );
    assert.equal(resultsState.results.players.length, players.length);
    const scoresAfterPublication = [...state.scores.entries()];

    assert.throws(
        () => fakeAnswer.handleAction(state, "publish-results"),
        { code: "RESULTS_ALREADY_PUBLISHED" }
    );
    assert.deepEqual([...state.scores.entries()], scoresAfterPublication);
    assert.throws(
        () => fakeAnswer.handleAction(state, "vote", players[0].id, "fake-client-score"),
        { code: "VOTING_NOT_OPEN" }
    );
});

test("fake-answer continuation waits for everyone and resets round data without resetting totals", () => {
    const room = createStartingRoom(2);
    gameManager.startGame(room, "fact-or-cap");

    function finishRound() {
        const questionState = gameManager.getPublicGameState(room.code, "player-1").state;
        gameManager.performGameAction(room.code, "fact-or-cap", null, "open-submissions");
        for (const player of room.players) {
            gameManager.performGameAction(
                room.code,
                "fact-or-cap",
                player.id,
                "submit-completion",
                `Round ${questionState.currentRound} answer from ${player.name}`
            );
        }
        gameManager.performGameAction(room.code, "fact-or-cap", null, "begin-voting");
        const correctCompletion = questions.find(
            ({ text }) => text === questionState.prompt.text
        ).correctCompletion;
        for (const player of room.players) {
            const options = gameManager.getPublicGameState(room.code, player.id).state.options;
            const correctOption = options.find(
                ({ completion }) => completion === correctCompletion
            );
            gameManager.performGameAction(
                room.code,
                "fact-or-cap",
                player.id,
                "vote",
                correctOption.id
            );
        }
        return gameManager.performGameAction(
            room.code,
            "fact-or-cap",
            null,
            "publish-results"
        );
    }

    try {
        const firstResults = finishRound().gameState;
        const firstRoundId = firstResults.state.roundId;
        const firstPromptId = firstResults.state.prompt.id;
        assert.equal(firstResults.status, "active");
        assert.equal(firstResults.state.results.players[0].totalScore, 2);

        const hostReady = gameManager.performGameAction(
            room.code,
            "fact-or-cap",
            "player-1",
            "continue"
        );
        assert.deepEqual(hostReady.result, {
            ready: true,
            advanced: false,
            readyCount: 1,
            playerCount: 2
        });
        assert.equal(hostReady.gameState.state.phase, "results");
        assert.equal(hostReady.gameState.state.continueReadyCount, 1);
        assert.equal(hostReady.gameState.state.viewerReadyToContinue, true);
        assert.deepEqual(
            hostReady.gameState.state.continueProgress.map(
                ({ playerId, ready }) => ({ playerId, ready })
            ),
            [
                { playerId: "player-1", ready: true },
                { playerId: "player-2", ready: false }
            ]
        );
        assert.throws(
            () => gameManager.performGameAction(
                room.code,
                "fact-or-cap",
                "player-1",
                "continue"
            ),
            { code: "ALREADY_READY" }
        );

        const advanced = gameManager.performGameAction(
            room.code,
            "fact-or-cap",
            "player-2",
            "continue"
        );
        assert.equal(advanced.result.advanced, true);
        assert.equal(advanced.gameState.state.phase, "question");
        assert.equal(advanced.gameState.state.currentRound, 2);
        assert.notEqual(advanced.gameState.state.roundId, firstRoundId);
        assert.notEqual(advanced.gameState.state.prompt.id, firstPromptId);
        assert.equal(advanced.gameState.state.submissionCount, 0);
        assert.equal(Object.hasOwn(advanced.gameState.state, "options"), false);
        assert.equal(Object.hasOwn(advanced.gameState.state, "results"), false);
        assert.equal(Object.hasOwn(advanced.gameState.state, "continueProgress"), false);

        const secondResults = finishRound().gameState;
        assert.equal(secondResults.state.currentRound, 2);
        assert.equal(secondResults.state.results.players[0].roundPoints, 2);
        assert.equal(secondResults.state.results.players[0].totalScore, 4);
        assert.equal(secondResults.state.results.players[1].totalScore, 4);
        assert.deepEqual(
            secondResults.state.results.standings.map(({ rank }) => rank),
            [1, 1]
        );
        assert.throws(
            () => gameManager.performGameAction(
                room.code,
                "fact-or-cap",
                null,
                "publish-results"
            ),
            { code: "RESULTS_ALREADY_PUBLISHED" }
        );
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("final statistics aggregate completed votes, preserve ties, and reset for rematches", () => {
    const room = createStartingRoom(4);
    gameManager.startGame(room, "fact-or-cap");
    try {
        let finalState;
        for (let round = 1; round <= 5; round += 1) {
            finalState = completeManagedRound(room, (player, currentRound, correct) => {
                if (player.id === "player-2") {
                    return correct;
                }
                if (player.id === "player-1") {
                    return `Private bluff ${currentRound} from player-2`;
                }
                return `Private bluff ${currentRound} from player-1`;
            });
            if (round < 5) {
                assert.equal(finalState.status, "active");
                assert.equal(Object.hasOwn(finalState.state, "finalStatistics"), false);
                const firstReady = gameManager.performGameAction(
                    room.code,
                    "fact-or-cap",
                    "player-1",
                    "continue"
                );
                assert.equal(firstReady.gameState.state.continueReadyCount, 1);
                assert.deepEqual(
                    firstReady.gameState.state.continueProgress.map(
                        ({ playerId, ready }) => ({ playerId, ready })
                    ),
                    [
                        { playerId: "player-1", ready: true },
                        { playerId: "player-2", ready: false },
                        { playerId: "player-3", ready: false },
                        { playerId: "player-4", ready: false }
                    ]
                );
                for (const player of room.players.slice(1)) {
                    gameManager.performGameAction(
                        room.code,
                        "fact-or-cap",
                        player.id,
                        "continue"
                    );
                }
            }
        }

        assert.equal(finalState.status, "finished");
        assert.equal(finalState.state.currentRound, 5);
        assert.equal(Object.hasOwn(finalState.state, "continueProgress"), false);
        assert.deepEqual(finalState.state.finalStatistics, {
            mostPlayersFooled: {
                playerIds: ["player-1"],
                count: 10
            },
            gotFooledMost: {
                playerIds: ["player-1", "player-3", "player-4"],
                count: 5
            },
            mostCorrectAnswers: {
                playerIds: ["player-2"],
                count: 5
            }
        });
        assert.deepEqual(
            finalState.state.results.standings.map(({ playerId, rank }) => ({
                playerId,
                rank
            })),
            [
                { playerId: "player-2", rank: 1 },
                { playerId: "player-1", rank: 2 },
                { playerId: "player-3", rank: 3 },
                { playerId: "player-4", rank: 3 }
            ]
        );

        const previousSessionId = finalState.sessionId;
        gameManager.removeGame(room.code, previousSessionId);
        const rematch = gameManager.startGame(room, "fact-or-cap");
        assert.notEqual(rematch.sessionId, previousSessionId);
        let rematchFinal;
        for (let round = 1; round <= 5; round += 1) {
            rematchFinal = completeManagedRound(
                room,
                (_player, _currentRound, correct) => correct
            );
            if (round < 5) {
                for (const player of room.players) {
                    gameManager.performGameAction(
                        room.code,
                        "fact-or-cap",
                        player.id,
                        "continue"
                    );
                }
            }
        }
        assert.deepEqual(rematchFinal.state.finalStatistics, {
            mostPlayersFooled: { playerIds: [], count: 0 },
            gotFooledMost: { playerIds: [], count: 0 },
            mostCorrectAnswers: {
                playerIds: ["player-1", "player-2", "player-3", "player-4"],
                count: 5
            }
        });
        assert.deepEqual(
            rematchFinal.state.results.standings.map(({ rank }) => rank),
            [1, 1, 1, 1]
        );
    } finally {
        gameManager.removeGame(room.code);
    }
});

test("question bank contains at least 15 unique prompts with source attribution", () => {
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

test("question selection prevents within-session repeats and prefers questions unused by the last session", () => {
    const pool = Array.from({ length: 10 }, (_, index) => ({
        id: `prompt-${index}`,
        text: `Prompt ${index}`,
        correctCompletion: `Answer ${index}`,
    }));
    const previousSessionIds = new Set(pool.slice(0, 5).map(({ id }) => id));
    const selected = selectQuestionOrder(
        pool,
        5,
        previousSessionIds,
        () => 0
    );

    assert.equal(new Set(selected.map(({ id }) => id)).size, 5);
    assert.equal(selected.some(({ id }) => previousSessionIds.has(id)), false);
});

test("question selection uses prior questions only when needed and fails clearly for insufficient playable content", () => {
    const pool = Array.from({ length: 6 }, (_, index) => ({
        id: `prompt-${index}`,
        text: `Prompt ${index}`,
        correctCompletion: `Answer ${index}`,
    }));
    const previousSessionIds = new Set(pool.slice(0, 5).map(({ id }) => id));
    const selected = selectQuestionOrder(
        pool,
        5,
        previousSessionIds,
        () => 0
    );

    assert.equal(selected.length, 5);
    assert.equal(new Set(selected.map(({ id }) => id)).size, 5);
    assert.ok(selected.some(({ id }) => !previousSessionIds.has(id)));
    assert.throws(
        () => selectQuestionOrder(pool.slice(0, 4), 5, new Set(), () => 0),
        { code: "QUESTION_POOL_EXHAUSTED" }
    );
    assert.throws(
        () => selectQuestionOrder([], 5, new Set(), () => 0),
        /at least 5 valid, unique playable prompts; found 0/
    );
});
