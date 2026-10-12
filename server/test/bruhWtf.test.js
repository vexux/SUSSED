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
