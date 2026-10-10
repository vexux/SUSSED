import assert from "node:assert/strict";
import test from "node:test";
import {
  getPersonalRoundFeedback,
  getRevealAnswerGroups,
} from "../src/games/fakeAnswer.ts";

function createResults(overrides = {}) {
  const results = {
    correctCompletion: "the real completion",
    options: [
      {
        id: "fake-option",
        completion: "the real completion",
        authorId: "player-2",
        authorName: "Player Two",
        isCorrect: false,
        voters: [{ playerId: "player-1", name: "Player One" }],
      },
      {
        id: "real-option",
        completion: "the real completion",
        authorId: null,
        authorName: null,
        isCorrect: true,
        voters: [{ playerId: "player-2", name: "Player Two" }],
      },
    ],
    players: [
      {
        playerId: "player-1",
        name: "Player One",
        submittedCompletion: "bluff one",
        voteOptionId: "fake-option",
        voteCompletion: "the real completion",
        voteCorrect: false,
        correctVotePoints: 0,
        bluffPoints: 0,
        roundPoints: 0,
        totalScore: 0,
      },
      {
        playerId: "player-2",
        name: "Player Two",
        submittedCompletion: "bluff two",
        voteOptionId: "real-option",
        voteCompletion: "the real completion",
        voteCorrect: true,
        correctVotePoints: 2,
        bluffPoints: 1,
        roundPoints: 3,
        totalScore: 3,
      },
    ],
    standings: [],
  };
  return { ...results, ...overrides };
}

test("groups reveal answers by authoritative correctness rather than answer text", () => {
  const results = createResults();
  const groups = getRevealAnswerGroups(results.options);

  assert.equal(groups.realOption.id, "real-option");
  assert.deepEqual(
    groups.realOption.voters.map(({ name }) => name),
    ["Player Two"],
  );
  assert.deepEqual(
    groups.fakeOptions.map(({ id, authorId, voters }) => ({
      id,
      authorId,
      voterNames: voters.map(({ name }) => name),
    })),
    [{
      id: "fake-option",
      authorId: "player-2",
      voterNames: ["Player One"],
    }],
  );
});

test("personalized feedback follows the player's selected option ID", () => {
  const results = createResults();

  assert.deepEqual(getPersonalRoundFeedback(results, "player-2"), {
    outcome: "correct",
    title: "Correct!",
    detail: "+2 points",
  });
  assert.deepEqual(getPersonalRoundFeedback(results, "player-1"), {
    outcome: "fooled",
    title: "Sike!",
    detail: "Player Two fooled you!",
  });
});

test("missing or invalid votes produce neutral feedback", () => {
  const noVoteResults = createResults({
    players: createResults().players.map((player) => ({
      ...player,
      voteOptionId: "",
    })),
  });

  assert.deepEqual(getPersonalRoundFeedback(noVoteResults, "player-1"), {
    outcome: "neutral",
    title: "No vote submitted",
    detail: "",
  });
  assert.deepEqual(getPersonalRoundFeedback(createResults(), null), {
    outcome: "neutral",
    title: "No vote submitted",
    detail: "",
  });
});
