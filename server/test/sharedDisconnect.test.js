const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../gameRegistry");

for (const { id } of registry.list()) {
    for (const phase of ["answer-submission", "voting", "results"]) {
        test(id + " resumes a shared disconnect during " + phase, () => {
            const game = registry.get(id);
            const players = ["a","b","c"].map(id => ({ id, name: id }));
            const state = game.start(game.createInitialState(players));
            if (state.phase === "question") game.handleAction(state, "open-submissions", null, {roundId: state.roundId});
            const submit = player => game.handleAction(state, id === "bruh-wtf" ? "submit-answer" : "submit-completion", player, player);
            submit("a");
            if (phase !== "answer-submission") {
                submit("b"); submit("c");
                if (state.phase === "reveal") game.handleAction(state, "begin-voting");
                for (const {id: player} of phase === "results" ? players : players.slice(0,1)) {
                    const option = state.options.find(o => o.authorId !== player);
                    game.handleAction(state,"vote",player,option.id);
                }
                if (state.phase === "waiting-for-results") game.handleAction(state,"publish-results");
            }
            const round = state.roundId;
            const scores = [...state.scores];
            for (const {id: player} of players) game.setPlayerConnectionStatus(state,player,false);
            assert.equal(state.roundId, round);
            assert.equal(state.phase, phase);
            for (const player of ["c","b","a","c"]) game.setPlayerConnectionStatus(state,player,true);
            assert.equal(state.roundId, round);
            assert.deepEqual([...state.scores], scores);
            assert.ok(game.isParticipantEligible(state,"c"));
            assert.ok((state.submissions ?? state.submittedAnswers).has("a"));
            if (phase === "answer-submission") submit("c");
            else if (phase === "voting") {
                assert.ok(state.votes.has("a"));
                game.handleAction(state,"vote","c",state.options.find(o=>o.authorId!=="c").id);
            } else game.handleAction(state,"continue","c");
        });
    }
}
