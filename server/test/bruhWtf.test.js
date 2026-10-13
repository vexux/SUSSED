const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { io: createClient } = require("socket.io-client");
const roomManager = require("../roomManager");
const gameManager = require("../gameManager");
const gameRegistry = require("../gameRegistry");
const { startServer } = require("../server");
const bruhWtf = require("../games/bruh-wtf/game");
const { loadQuestionPacks, validateQuestionPack, validateTemplate } = require("../games/bruh-wtf/questionLibrary");

const players = [
    { id: "p1", name: "Alex" },
    { id: "p2", name: "Bailey" },
    { id: "p3", name: "Casey" }
];

function makeState(roundCount = 5) {
    return bruhWtf.start(bruhWtf.createInitialState(players, { roundCount }));
}

function submitAll(state, prefix = "answer") {
    for (const player of players) bruhWtf.handleAction(state, "submit-answer", player.id, `${prefix} ${player.name}`);
}

function voteFor(state, playerId, authorId) {
    const option = state.options.find(({ authorId: owner }) => owner === authorId);
    return bruhWtf.handleAction(state, "vote", playerId, option.id);
}

function readyForResults(state) {
    submitAll(state);
    voteFor(state, "p1", "p2");
    voteFor(state, "p2", "p1");
    voteFor(state, "p3", "p1");
    assert.equal(state.phase, "waiting-for-results");
}

function emitWithAck(client, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 3000);
        client.emit(event, payload, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function waitForGameState(client, predicate) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            client.off("game-state", onState);
            reject(new Error("game-state event timed out"));
        }, 3000);
        function onState(state) {
            if (!predicate(state)) return;
            clearTimeout(timer);
            client.off("game-state", onState);
            resolve(state);
        }
        client.on("game-state", onState);
    });
}

async function createSocketHarness(context) {
    const io = startServer(0);
    await new Promise((resolve, reject) => {
        io.httpServer.once("listening", resolve);
        io.httpServer.once("error", reject);
    });
    const port = io.httpServer.address().port;
    const clients = [];
    const rooms = new Set();
    context.after(async () => {
        for (const client of clients) client.close();
        await new Promise((resolve) => io.close(resolve));
        for (const room of rooms) {
            roomManager.removeRoom(room);
            gameManager.removeGame(room);
        }
    });
    const connect = async () => {
        const client = createClient(`http://127.0.0.1:${port}`, { reconnection: false });
        clients.push(client);
        await new Promise((resolve, reject) => {
            client.once("connect", resolve);
            client.once("connect_error", reject);
        });
        return client;
    };
    return { connect, rooms };
}

async function startBruhResults(context, { roundCount = 5 } = {}) {
    const harness = await createSocketHarness(context);
    const clients = await Promise.all([harness.connect(), harness.connect(), harness.connect()]);
    const [host, guest, third] = clients;
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.rooms.add(created.roomCode);
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    await emitWithAck(third, "join-room", { roomCode: created.roomCode, playerName: "Third" });
    await emitWithAck(guest, "set-ready", { isReady: true });
    await emitWithAck(third, "set-ready", { isReady: true });
    const selected = await emitWithAck(host, "select-game", { gameId: "bruh-wtf" });
    await emitWithAck(host, "select-round-count", { roundCount, revision: selected.lobby.revision });
    const started = await new Promise((resolve) => host.emit("start-game", resolve));
    assert.equal(started.error, undefined, JSON.stringify(started));
    const { sessionId } = started.game;
    const roundId = started.game.state.roundId;
    for (const [client, answer] of [[host, "Host answer"], [guest, "Guest answer"], [third, "Third answer"]]) {
        assert.equal((await emitWithAck(client, "bruh-wtf:submit", { sessionId, roundId, answer })).submitted, true);
    }
    const states = clients.map((client) => gameManager.getPublicGameState(created.roomCode, client.id).state);
    const targetAnswer = (voterIndex, text) => {
        const option = states[voterIndex].options.find(({ completion }) => completion === text);
        assert.ok(option);
        return option.id;
    };
    for (const [index, target] of [[0, "Third answer"], [1, "Host answer"], [2, "Host answer"]]) {
        assert.equal((await emitWithAck(clients[index], "bruh-wtf:vote", {
            sessionId,
            roundId,
            optionId: targetAnswer(index, target)
        })).voted, true);
    }
    assert.equal(gameManager.getPublicGameState(created.roomCode, host.id).state.phase, "results");
    return { clients, host, guest, third, created, sessionId, roundId };
}

test("Bruh wtf? is registered with its own game implementation and protocol", () => {
    assert.equal(gameRegistry.get("bruh-wtf"), bruhWtf);
    assert.equal(bruhWtf.displayName, "Bruh wtf?");
    assert.equal(bruhWtf.socketProtocol, "bruh-wtf");
    assert.deepEqual(bruhWtf.supportedPlayers, { min: 3 });
});

test("prompt packs validate IDs and distinct, contiguous placeholder syntax", () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../games/bruh-wtf/content/development-fixtures.json"), "utf8"));
    assert.deepEqual(validateQuestionPack(fixture).errors, []);
    assert.equal(fixture.questions.length, 11);
    assert.equal(validateTemplate({ prompt: "Hi {{player1}}", requiredPlayers: 1 }, "test"), null);
    assert.match(validateTemplate({ prompt: "Hi {{player1}} {{player1}}", requiredPlayers: 2 }, "test"), /exactly once/u);
    assert.match(validateTemplate({ prompt: "Hi {{player2}}", requiredPlayers: 2 }, "test"), /through/u);
    assert.match(validateTemplate({ prompt: "Hi {player1}", requiredPlayers: 1 }, "test"), /malformed/u);
    const broken = { ...fixture, questions: [{ ...fixture.questions[0], requiredPlayers: 2 }] };
    assert.ok(validateQuestionPack(broken).errors.some((error) => error.includes("placeholder")));
    assert.ok(validateQuestionPack({ ...fixture, formatVersion: 2 }).errors.some((error) => error.includes("formatVersion")));
    assert.ok(validateQuestionPack({ ...fixture, unexpected: true }).errors.some((error) => error.includes("unknown pack field")));
    assert.ok(validateQuestionPack({ ...fixture, questions: [fixture.questions[0], fixture.questions[0]] }).errors.some((error) => error.includes("duplicate question ID")));
});

test("placeholder resolution assigns different eligible roster members", () => {
    const state = makeState();
    const question = loadQuestionPacks().find(({ requiredPlayers }) => requiredPlayers === 3);
    assert.ok(question);
    const resolved = bruhWtf.resolvePrompt(question, players);
    assert.match(resolved, /Alex/u);
    assert.match(resolved, /Bailey/u);
    assert.match(resolved, /Casey/u);
    assert.equal(/\{\{player\d+\}\}/u.test(resolved), false);
    const twoPlayerQuestion = loadQuestionPacks().find(({ requiredPlayers }) => requiredPlayers === 2);
    assert.ok(twoPlayerQuestion);
    const twoPlayerPrompt = bruhWtf.resolvePrompt(twoPlayerQuestion, players);
    const names = players.map(({ name }) => name).filter((name) => twoPlayerPrompt.includes(name));
    assert.equal(names.length, 2);
    const tokenLikeName = bruhWtf.resolvePrompt(
        { ...twoPlayerQuestion, prompt: "Say hi to {{player1}} and {{player2}}." },
        [{ id: "x", name: "{{player2}}" }, { id: "y", name: "Riley" }]
    );
    assert.equal(/\{\{player\d+\}\}/u.test(tokenLikeName), false);
});

test("submissions validate membership, phase, payload and duplicate actions without exposing answers", () => {
    const state = makeState();
    assert.throws(() => bruhWtf.handleAction(state, "vote", "p1", "none"), { code: "VOTING_NOT_OPEN" });
    assert.throws(() => bruhWtf.handleAction(state, "submit-answer", "outsider", "text"), { code: "NOT_A_GAME_PLAYER" });
    assert.throws(() => bruhWtf.handleAction(state, "submit-answer", "p1", " "), { code: "INVALID_ANSWER" });
    assert.throws(() => bruhWtf.handleAction(state, "submit-answer", "p1", "x".repeat(161)), { code: "INVALID_ANSWER" });
    bruhWtf.handleAction(state, "submit-answer", "p1", "Secret one");
    const publicSubmission = bruhWtf.createPublicState(state, "p1");
    assert.equal(JSON.stringify(publicSubmission).includes("Secret one"), false);
    assert.throws(() => bruhWtf.handleAction(state, "submit-answer", "p1", "again"), { code: "ALREADY_SUBMITTED" });
    bruhWtf.handleAction(state, "submit-answer", "p2", "Secret two");
    bruhWtf.handleAction(state, "submit-answer", "p3", "Secret three");
    assert.equal(state.phase, "voting");
    for (const player of players) {
        const publicVote = bruhWtf.createPublicState(state, player.id);
        assert.equal(publicVote.options.some((option) => "authorId" in option), false);
        assert.equal(publicVote.options.length, players.length);
        assert.equal(publicVote.options.filter(({ isOwnAnswer }) => isOwnAnswer).length, 1);
        const expectedOwnAnswer = new Map([["p1", "Secret one"], ["p2", "Secret two"], ["p3", "Secret three"]]).get(player.id);
        assert.equal(publicVote.options.find(({ isOwnAnswer }) => isOwnAnswer).completion, expectedOwnAnswer);
        assert.equal(JSON.stringify(publicVote).includes("authorId"), false);
    }
});

test("votes reject own, invalid, duplicate and stale-phase choices; results score +1 per vote", () => {
    const state = makeState();
    submitAll(state);
    const ownOption = state.options.find(({ authorId }) => authorId === "p1");
    assert.throws(() => bruhWtf.handleAction(state, "vote", "p1", ownOption.id), { code: "OWN_ANSWER_NOT_ALLOWED" });
    assert.throws(() => bruhWtf.handleAction(state, "vote", "p1", "not-an-option"), { code: "INVALID_OPTION" });
    voteFor(state, "p1", "p2");
    assert.throws(() => bruhWtf.handleAction(state, "vote", "p1", state.options[0].id), { code: "ALREADY_VOTED" });
    voteFor(state, "p2", "p1");
    voteFor(state, "p3", "p1");
    assert.equal(state.phase, "waiting-for-results");
    assert.throws(() => bruhWtf.handleAction(state, "vote", "p1", state.options[0].id), { code: "VOTING_NOT_OPEN" });
    assert.deepEqual([...state.scores.values()], [0, 0, 0]);
    bruhWtf.handleAction(state, "publish-results");
    assert.deepEqual([...state.scores.entries()], [["p1", 2], ["p2", 1], ["p3", 0]]);
    const result = state.results.answers.find(({ authorId }) => authorId === "p1");
    assert.deepEqual(result.voterNames.sort(), ["Bailey", "Casey"]);
    assert.equal(result.voteCount, 2);
    assert.equal(result.pointsAwarded, 2);
    assert.throws(() => bruhWtf.handleAction(state, "publish-results"), { code: "RESULTS_ALREADY_PUBLISHED" });
});

test("final results report tied winners and continuation advances only after every player is ready", () => {
    const state = makeState(7);
    readyForResults(state);
    bruhWtf.handleAction(state, "publish-results");
    assert.equal(state.results.winners, undefined);
    assert.throws(() => bruhWtf.handleAction(state, "continue", "outside"), { code: "NOT_A_GAME_PLAYER" });
    assert.equal(bruhWtf.handleAction(state, "continue", "p1").advanced, false);
    assert.throws(() => bruhWtf.handleAction(state, "continue", "p1"), { code: "ALREADY_READY" });
    assert.equal(bruhWtf.handleAction(state, "continue", "p2").advanced, false);
    assert.equal(bruhWtf.handleAction(state, "continue", "p3").advanced, true);
    assert.equal(state.currentRound, 2);
    assert.equal(state.phase, "answer-submission");
    assert.equal(/\{\{player\d+\}\}/u.test(state.resolvedPrompt), false);
    assert.equal(state.questionOrder.length, 7);
    assert.throws(() => bruhWtf.handleAction(state, "publish-results"), { code: "VOTES_NOT_COMPLETE" });

});

test("final leaderboard reports all tied winners", () => {
    const state = makeState(5);
    state.currentRound = state.totalRounds;
    submitAll(state, "final");
    voteFor(state, "p1", "p2");
    voteFor(state, "p2", "p3");
    voteFor(state, "p3", "p1");
    bruhWtf.handleAction(state, "publish-results");
    assert.equal(state.results.winners.length, 3);
    assert.deepEqual(state.results.winners.map(({ name }) => name).sort(), ["Alex", "Bailey", "Casey"]);
    assert.equal(bruhWtf.isFinished(state), true);
});

test("configured 5, 7 and 10 rounds select unique eligible prompts", () => {
    for (const roundCount of [5, 7, 10]) {
        const state = makeState(roundCount);
        assert.equal(state.questionOrder.length, roundCount);
        assert.equal(new Set(state.questionOrder.map(({ id }) => id)).size, roundCount);
    }
    const twoPlayers = bruhWtf.createInitialState(players.slice(0, 2), { roundCount: 10 });
    assert.equal(twoPlayers.questionOrder.length, 10);
});

test("Socket.IO starts the selected Bruh wtf? game and publishes round results", async (context) => {
    const harness = await createSocketHarness(context);
    const host = await harness.connect();
    const guest = await harness.connect();
    const thirdPlayer = await harness.connect();
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.rooms.add(created.roomCode);
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    await emitWithAck(thirdPlayer, "join-room", { roomCode: created.roomCode, playerName: "Third" });
    await emitWithAck(guest, "set-ready", { isReady: true });
    await emitWithAck(thirdPlayer, "set-ready", { isReady: true });
    const selected = await emitWithAck(host, "select-game", { gameId: "bruh-wtf" });
    assert.equal(selected.selectedGameId, "bruh-wtf");
    const configured = await emitWithAck(host, "select-round-count", { roundCount: 7, revision: selected.lobby.revision });
    const started = await new Promise((resolve) => host.emit("start-game", resolve));
    assert.equal(started.error, undefined, JSON.stringify(started));
    assert.equal(started.game.gameId, "bruh-wtf");
    assert.equal(started.game.state.phase, "answer-submission");
    assert.equal(started.game.state.totalRounds, 7);
    const { sessionId } = started.game;
    const { roundId } = started.game.state;
    assert.equal((await emitWithAck(host, "bruh-wtf:submit", { sessionId, roundId: "stale-round", answer: "stale" })).error.code, "ROUND_MISMATCH");
    for (const [client, answer] of [[host, "Host's answer"], [guest, "Guest's answer"], [thirdPlayer, "Third's answer"]]) {
        assert.equal((await emitWithAck(client, "bruh-wtf:submit", { sessionId, roundId, answer })).submitted, true);
    }
    const hostVoting = gameManager.getPublicGameState(created.roomCode, host.id);
    const guestVoting = gameManager.getPublicGameState(created.roomCode, guest.id);
    const thirdVoting = gameManager.getPublicGameState(created.roomCode, thirdPlayer.id);
    assert.equal(hostVoting.state.phase, "voting");
    assert.equal(hostVoting.state.options.length, 3);
    assert.equal(guestVoting.state.options.length, 3);
    assert.equal(thirdVoting.state.options.length, 3);
    const ownOption = hostVoting.state.options.find(({ isOwnAnswer }) => isOwnAnswer);
    const hostOption = hostVoting.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
    const invalidVote = await emitWithAck(host, "bruh-wtf:vote", { sessionId, roundId, optionId: ownOption.id });
    assert.equal(invalidVote.error.code, "OWN_ANSWER_NOT_ALLOWED");
    assert.equal(gameManager.getPublicGameState(created.roomCode, host.id).state.voteCount, 0);
    const votePayload = { sessionId, roundId, optionId: hostOption.id };
    const voteOne = await emitWithAck(host, "bruh-wtf:vote", votePayload);
    assert.equal(voteOne.voted, true);
    assert.equal((await emitWithAck(host, "bruh-wtf:vote", votePayload)).error.code, "ALREADY_VOTED");
    const guestOption = guestVoting.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
    const thirdOption = thirdVoting.state.options.find(({ isOwnAnswer }) => !isOwnAnswer);
    assert.equal((await emitWithAck(guest, "bruh-wtf:vote", { sessionId, roundId, optionId: guestOption.id })).voted, true);
    assert.equal((await emitWithAck(thirdPlayer, "bruh-wtf:vote", { sessionId, roundId, optionId: thirdOption.id })).voted, true);
    const results = gameManager.getPublicGameState(created.roomCode, host.id);
    assert.equal(results.state.phase, "results");
    assert.equal(results.state.results.answers.length, 3);
    assert.equal(results.state.results.leaderboard.reduce((sum, player) => sum + player.score, 0), 3);
});

test("three-player Bruh wtf? socket session completes rounds, preserves privacy, and returns to lobby", async (context) => {
    const harness = await createSocketHarness(context);
    const clients = await Promise.all([harness.connect(), harness.connect(), harness.connect()]);
    const host = clients[0];
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.rooms.add(created.roomCode);
    await emitWithAck(clients[1], "join-room", { roomCode: created.roomCode, playerName: "Guest One" });
    await emitWithAck(clients[2], "join-room", { roomCode: created.roomCode, playerName: "Guest Two" });
    await emitWithAck(clients[1], "set-ready", { isReady: true });
    await emitWithAck(clients[2], "set-ready", { isReady: true });
    const selected = await emitWithAck(host, "select-game", { gameId: "bruh-wtf" });
    await emitWithAck(host, "select-round-count", { roundCount: 5, revision: selected.lobby.revision });
    const started = await new Promise((resolve) => host.emit("start-game", resolve));
    assert.equal(started.error, undefined, JSON.stringify(started));

    const { sessionId } = started.game;
    for (let round = 1; round <= 5; round += 1) {
        const initial = gameManager.getPublicGameState(created.roomCode, host.id);
        assert.equal(initial.state.phase, "answer-submission");
        assert.equal(initial.state.currentRound, round);
        const { roundId } = initial.state;
        const answers = clients.map((_, index) => `private-${round}-${index}`);

        for (let index = 0; index < clients.length; index += 1) {
            const response = await emitWithAck(clients[index], "bruh-wtf:submit", {
                sessionId,
                roundId,
                answer: answers[index]
            });
            assert.equal(response.submitted, true);
            if (index === 0) {
                for (const viewer of clients) {
                    const state = gameManager.getPublicGameState(created.roomCode, viewer.id).state;
                    assert.equal(JSON.stringify(state).includes(answers[0]), false);
                }
            }
        }

        const votingStates = clients.map((client) => gameManager.getPublicGameState(created.roomCode, client.id).state);
        assert.ok(votingStates.every(({ phase }) => phase === "voting"));
        for (const state of votingStates) {
            assert.ok(state.options.every((option) => !Object.hasOwn(option, "authorId")));
            assert.equal(state.options.filter(({ isOwnAnswer }) => isOwnAnswer).length, 1);
        }

        for (let index = 0; index < clients.length; index += 1) {
            const option = votingStates[index].options.find(({ isOwnAnswer }) => !isOwnAnswer);
            const response = await emitWithAck(clients[index], "bruh-wtf:vote", { sessionId, roundId, optionId: option.id });
            assert.equal(response.voted, true);
        }
        const results = gameManager.getPublicGameState(created.roomCode, host.id).state;
        assert.equal(results.phase, "results");
        assert.equal(results.results.answers.length, 3);
        assert.equal(results.results.roundScores.reduce((total, player) => total + player.pointsEarned, 0), 3);
        assert.equal(results.results.leaderboard.reduce((total, player) => total + player.score, 0), round * 3);

        if (round < 5) {
            for (let index = 0; index < clients.length; index += 1) {
                const response = await emitWithAck(clients[index], "bruh-wtf:continue", { sessionId, roundId });
                assert.equal(response.advanced, index === clients.length - 1);
            }
        }
    }

    assert.equal(gameManager.getPublicGameState(created.roomCode, host.id).status, "finished");
    assert.deepEqual(await emitWithAck(host, "return-to-lobby", { sessionId }), { returned: true });
    assert.equal(roomManager.createLobbyState(roomManager.getRoom(created.roomCode)).selectedGameId, "bruh-wtf");
});

test("Bruh wtf? continues with two players after the host leaves mid-round", async (context) => {
    const harness = await createSocketHarness(context);
    const clients = [await harness.connect(), await harness.connect(), await harness.connect()];
    const [host, guest, third] = clients;
    const created = await emitWithAck(host, "create-room", { playerName: "Host" });
    harness.rooms.add(created.roomCode);
    await emitWithAck(guest, "join-room", { roomCode: created.roomCode, playerName: "Guest" });
    await emitWithAck(third, "join-room", { roomCode: created.roomCode, playerName: "Third" });
    await emitWithAck(guest, "set-ready", { isReady: true });
    await emitWithAck(third, "set-ready", { isReady: true });
    await emitWithAck(host, "select-game", { gameId: "bruh-wtf" });
    const started = await new Promise((resolve) => host.emit("start-game", resolve));
    assert.equal(started.error, undefined, JSON.stringify(started));
    const sessionId = started.game.sessionId;
    const roundId = started.game.state.roundId;
    const remainingState = waitForGameState(guest, (state) => state.sessionId === sessionId && state.state.playerCount === 2);

    const left = await new Promise((resolve) => host.emit("leave-room", resolve));
    assert.deepEqual(left, { left: true });
    const update = await remainingState;
    assert.equal(update.players.some(({ id }) => id === host.id), false);
    assert.equal(update.players[0].id, guest.id);
    assert.equal(roomManager.getRoom(created.roomCode).hostId, guest.id);
    assert.equal((await emitWithAck(host, "bruh-wtf:submit", { sessionId, roundId, answer: "not a participant" })).error.code, "NOT_IN_ROOM");

    for (const [client, answer] of [[guest, "Guest answer"], [third, "Third answer"]]) {
        assert.equal((await emitWithAck(client, "bruh-wtf:submit", { sessionId, roundId, answer })).submitted, true);
    }
    const guestState = gameManager.getPublicGameState(created.roomCode, guest.id).state;
    const thirdState = gameManager.getPublicGameState(created.roomCode, third.id).state;
    assert.equal(guestState.phase, "voting");
    assert.equal(guestState.options.length, 2);
    assert.equal((await emitWithAck(guest, "bruh-wtf:vote", {
        sessionId, roundId, optionId: guestState.options.find(({ isOwnAnswer }) => !isOwnAnswer).id
    })).voted, true);
    assert.equal((await emitWithAck(third, "bruh-wtf:vote", {
        sessionId, roundId, optionId: thirdState.options.find(({ isOwnAnswer }) => !isOwnAnswer).id
    })).voted, true);
    const results = gameManager.getPublicGameState(created.roomCode, guest.id);
    assert.equal(results.state.phase, "results");
    assert.equal(results.state.results.leaderboard.length, 2);
    assert.equal(results.state.results.leaderboard.reduce((sum, player) => sum + player.score, 0), 2);
});

test("Bruh results stay published when the host voter explicitly leaves and remaining players continue", async (context) => {
    const { host, guest, third, created, sessionId, roundId } = await startBruhResults(context, { roundCount: 5 });
    const published = gameManager.getPublicGameState(created.roomCode, guest.id).state.results;
    const hostVote = published.answers.find(({ authorId }) => authorId === third.id);
    assert.equal(hostVote.voteCount, 1);
    assert.deepEqual(hostVote.voterNames, ["Host"]);

    const updated = waitForGameState(guest, (state) => state.sessionId === sessionId &&
        state.state.phase === "results" && state.state.playerCount === 2);
    assert.deepEqual(await new Promise((resolve) => host.emit("leave-room", resolve)), { left: true });
    const state = (await updated).state;
    assert.equal(roomManager.getRoom(created.roomCode).hostId, guest.id);
    assert.equal(state.results.answers.find(({ authorId }) => authorId === third.id).voteCount, 1);
    assert.deepEqual(state.results.answers.find(({ authorId }) => authorId === third.id).voterNames, ["Host"]);
    assert.equal(state.results.activeLeaderboard.some(({ playerId }) => playerId === host.id), false);
    assert.equal(state.results.activeLeaderboard.find(({ playerId }) => playerId === third.id).score, 1);
    assert.equal((await emitWithAck(guest, "bruh-wtf:vote", {
        sessionId, roundId, optionId: "already-published-option"
    })).error.code, "VOTING_NOT_OPEN");

    assert.equal((await emitWithAck(guest, "bruh-wtf:continue", { sessionId, roundId })).advanced, false);
    assert.equal((await emitWithAck(third, "bruh-wtf:continue", { sessionId, roundId })).advanced, true);
    const nextRound = gameManager.getPublicGameState(created.roomCode, guest.id).state;
    assert.equal(nextRound.phase, "answer-submission");
    assert.equal(nextRound.currentRound, 2);
    assert.equal(nextRound.playerCount, 2);
});

test("Bruh results preserve a disconnected answer author's published history", async (context) => {
    const { host, guest, third, created, sessionId } = await startBruhResults(context, { roundCount: 5 });
    const thirdId = third.id;
    const before = gameManager.getPublicGameState(created.roomCode, host.id).state.results;
    const thirdAnswer = before.answers.find(({ authorId }) => authorId === thirdId);
    assert.ok(thirdAnswer);
    const updated = waitForGameState(host, (state) => state.sessionId === sessionId &&
        state.state.phase === "results" && state.state.playerCount === 2);
    third.disconnect();
    await updated;
    const state = gameManager.getPublicGameState(created.roomCode, host.id).state;
    assert.equal(state.results.answers.find(({ authorId }) => authorId === thirdId).completion, "Third answer");
    assert.equal(state.results.answers.find(({ authorId }) => authorId === thirdId).voteCount, thirdAnswer.voteCount);
    assert.deepEqual(state.results.answers.find(({ authorId }) => authorId === thirdId).voterNames, thirdAnswer.voterNames);
    assert.equal(state.results.activeLeaderboard.some(({ playerId }) => playerId === thirdId), false);
    assert.equal(state.phase, "results");
    assert.equal(gameManager.getPublicGameState(created.roomCode, guest.id).state.phase, "results");
});
