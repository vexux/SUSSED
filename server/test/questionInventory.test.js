const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildQuestionInventory, formatQuestionInventory } = require("../games/fact-or-cap/questionInventory");

function question(id, text, completion, contentPackId) {
    return {
        id,
        text,
        correctCompletion: completion,
        sourceName: "Fixture source",
        sourceUrl: "https://example.com/source",
        contentPackId
    };
}

test("question inventory deterministically reports packs, invalid files, duplicate IDs and likely duplicate matches without writes", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-question-inventory-"));
    const directories = {
        "fact-or-cap": path.join(root, "general"),
        "fact-or-cap-anime": path.join(root, "anime")
    };
    for (const directory of Object.values(directories)) fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directories["fact-or-cap"], "general-one.json"), JSON.stringify({
        contentPackId: "general-one",
        questions: [
            question("shared-question", "A prompt ____.", "Answer!", "general-one"),
            question("another-question", "A prompt ____.", "Answer", "general-one")
        ]
    }));
    fs.writeFileSync(path.join(directories["fact-or-cap"], "broken.json"), "{invalid");
    fs.writeFileSync(path.join(directories["fact-or-cap-anime"], "anime-one.json"), JSON.stringify({
        contentPackId: "anime-one",
        questions: [question("shared-question", "A prompt ____.", "Answer", "anime-one")]
    }));
    const snapshot = () => Object.fromEntries(Object.values(directories).map((directory) => [
        directory,
        fs.readdirSync(directory).sort().map((name) => [name, fs.readFileSync(path.join(directory, name), "utf8")])
    ]));
    const before = snapshot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const first = buildQuestionInventory({ contentDirectories: directories });
    const second = buildQuestionInventory({ contentDirectories: directories });
    assert.deepEqual(first, second);
    assert.equal(first.banks[0].gameId, "fact-or-cap");
    assert.equal(first.banks[0].totalQuestions, 2);
    assert.equal(first.banks[0].packs[0].fileName, "broken.json");
    assert.ok(first.banks[0].validationErrors.some((error) => error.includes("unable to read JSON")));
    assert.equal(first.banks[0].likelyDuplicateContentCount, 1);
    assert.equal(first.crossBankDuplicateIds.length, 1);
    assert.equal(first.crossBankDuplicateIds[0].questionId, "shared-question");
    assert.equal(first.crossBankLikelyDuplicateContentCount, 2);
    assert.equal(first.hasErrors, true);
    assert.match(formatQuestionInventory(first), /Cross-bank likely normalized prompt\/answer matches: 2/);
    assert.deepEqual(snapshot(), before);
});
