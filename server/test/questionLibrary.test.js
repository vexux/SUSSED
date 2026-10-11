const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
    questions,
    selectQuestions,
} = require("../games/fake-answer/questionBank");
const { questions: animeQuestions } = require("../games/fake-answer/animeQuestionBank");
const {
    loadQuestionPacks,
    readPack,
    validateQuestionLibrary,
    validateQuestionPack,
} = require("../games/fake-answer/questionLibrary");

const fakeAnswerDirectory = path.join(__dirname, "..", "games", "fake-answer");

test("loads all migrated JSON content packs with existing answer and source data", () => {
    const { questions: loaded } = loadQuestionPacks(
        path.join(fakeAnswerDirectory, "content")
    );
    assert.equal(loaded.length, 100);
    assert.equal(questions.length, 100);
    assert.equal(new Set(loaded.map(({ id }) => id)).size, loaded.length);
    assert.equal(
        loaded.find(({ id }) => id === "wombat-cubes").correctCompletion,
        "small cubes"
    );
    assert.equal(
        loaded.find(({ id }) => id === "wombat-cubes").sourceUrl,
        "https://www.nature.com/articles/s41586-018-0751-9"
    );
    assert.deepEqual(
        new Set(loaded.map(({ contentPackId }) => contentPackId)),
        new Set(["wildlife", "space", "world-and-culture", "general-facts-batch-2026-10"])
    );
});

test("loads the expanded anime library and its new sourced pack with distinct IDs", () => {
    const { questions: loaded } = loadQuestionPacks(
        path.join(fakeAnswerDirectory, "content-anime")
    );
    assert.equal(loaded.length, 348);
    assert.equal(animeQuestions.length, 348);
    assert.equal(new Set(loaded.map(({ id }) => id)).size, 348);
    assert.equal(
        loaded.filter(({ contentPackId }) => contentPackId === "anime-bizarre-batch-001").length,
        40
    );
    assert.equal(
        loaded.filter(({ contentPackId }) => contentPackId === "anime-bizarre-batch-002").length,
        33
    );
    assert.equal(
        loaded.filter(({ contentPackId }) => contentPackId === "anime-bizarre-batch-003").length,
        76
    );
    assert.ok(loaded.some(({ difficulty }) => difficulty === "extremely-hard"));
    assert.ok(loaded.every(({ sourceName, sourceUrl, category, tags }) =>
        sourceName && sourceUrl.startsWith("https://") &&
        category && tags.length > 0
    ));
    assert.equal(
        questions.some(({ id }) => loaded.some((animeQuestion) => animeQuestion.id === id)),
        false
    );
});

test("the library selector avoids reusing the immediately preceding session when possible", () => {
    const firstSession = selectQuestions(5);
    const secondSession = selectQuestions(5);
    const firstIds = new Set(firstSession.map(({ id }) => id));

    assert.equal(firstSession.length, 5);
    assert.equal(secondSession.length, 5);
    assert.equal(new Set(secondSession.map(({ id }) => id)).size, 5);
    assert.equal(secondSession.some(({ id }) => firstIds.has(id)), false);
});

test("question pack validation reports malformed required fields and source URLs", () => {
    const result = validateQuestionPack({
        questions: [{
            id: "bad-entry",
            text: "   ",
            correctCompletion: "",
            sourceUrl: "javascript:alert(1)",
            difficulty: "impossible",
        }],
    }, "candidate.json");

    assert.equal(result.questions.length, 0);
    assert.match(result.errors.join("\n"), /candidate\.json: question "bad-entry"/);
    assert.match(result.errors.join("\n"), /non-empty string "text"/);
    assert.match(result.errors.join("\n"), /non-empty string "correctCompletion"/);
    assert.match(result.errors.join("\n"), /sourceUrl must use HTTP or HTTPS/);
    assert.match(result.errors.join("\n"), /difficulty must be/);
});

test("question difficulty is optional and accepts the four supported values", () => {
    for (const difficulty of ["easy", "medium", "hard", "extremely-hard"]) {
        const result = validateQuestionPack({
            questions: [{
                id: `question-${difficulty}`,
                text: "A valid prompt",
                correctCompletion: "a valid completion",
                difficulty,
            }],
        }, "candidate.json");

        assert.deepEqual(result.errors, [], `${difficulty} should be accepted`);
        assert.equal(result.questions[0].difficulty, difficulty);
    }

    const withoutDifficulty = validateQuestionPack({
        questions: [{
            id: "question-without-difficulty",
            text: "A valid prompt",
            correctCompletion: "a valid completion",
        }],
    }, "candidate.json");
    assert.deepEqual(withoutDifficulty.errors, []);
    assert.equal(withoutDifficulty.questions[0].difficulty, undefined);
});

test("question difficulty rejects unsupported values and lists supported values", () => {
    const result = validateQuestionPack({
        questions: [{
            id: "question-invalid-difficulty",
            text: "A valid prompt",
            correctCompletion: "a valid completion",
            difficulty: "expert",
        }],
    }, "candidate.json");

    assert.equal(result.questions.length, 0);
    assert.match(
        result.errors.join("\n"),
        /difficulty must be "easy", "medium", "hard", or "extremely-hard"/
    );
});

test("library validation blocks cross-pack ID conflicts and warns without deleting likely duplicates", () => {
    const duplicatePrompt = "A FACT, stated here...";
    const result = validateQuestionLibrary([
        {
            fileName: "first.json",
            data: {
                questions: [{
                    id: "shared-id",
                    text: duplicatePrompt,
                    correctCompletion: "The Answer!",
                }],
            },
        },
        {
            fileName: "second.json",
            data: {
                questions: [
                    {
                        id: "shared-id",
                        text: duplicatePrompt,
                        correctCompletion: "The Answer!",
                    },
                    {
                        id: "other-id",
                        text: "a fact stated here",
                        correctCompletion: "the answer",
                    },
                ],
            },
        },
    ]);

    assert.equal(result.questions.length, 3);
    assert.match(result.errors.join("\n"), /second\.json: question "shared-id".*duplicates question ID/);
    assert.match(result.warnings.join("\n"), /second\.json: question "other-id".*may duplicate/);
});

test("question pack parser identifies malformed JSON by file", (context) => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-question-pack-"));
    context.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));
    const filePath = path.join(tempDirectory, "broken.json");
    fs.writeFileSync(filePath, "{ definitely not json");

    assert.throws(() => readPack(filePath), /Invalid JSON in ".*broken\.json"/);
});

test("bulk validation reports library ID conflicts and duplicate candidates without modifying data", (context) => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-question-import-"));
    context.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));
    const filePath = path.join(tempDirectory, "candidate.json");
    const scriptPath = path.join(fakeAnswerDirectory, "scripts", "validate-question-pack.js");
    fs.writeFileSync(filePath, JSON.stringify({
        contentPackId: "candidate-pack",
        questions: [{
            id: "new-wombat-entry",
            text: "A WOMBAT'S droppings are famously shaped like",
            correctCompletion: "SMALL cubes!!!",
        }],
    }));

    const duplicateRun = spawnSync(process.execPath, [scriptPath, filePath], {
        encoding: "utf8",
    });

    test("bulk validation selects the requested variant library and rejects cross-variant ID conflicts", (context) => {
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-anime-import-"));
        context.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));
        const filePath = path.join(tempDirectory, "candidate.json");
        const scriptPath = path.join(fakeAnswerDirectory, "scripts", "validate-question-pack.js");
        fs.writeFileSync(filePath, JSON.stringify({
            questions: [{
                id: "anime-new-entry",
                text: "A sourced anime prompt",
                correctCompletion: "a sourced answer",
                sourceName: "Example source",
                sourceUrl: "https://example.org/source",
            }],
        }));
        const validRun = spawnSync(
            process.execPath,
            [scriptPath, "--game", "fact-or-cap-anime", filePath],
            { encoding: "utf8" }
        );
        assert.equal(validRun.status, 0);

        fs.writeFileSync(filePath, JSON.stringify({
            questions: [{
                id: "wombat-cubes",
                text: "An anime question",
                correctCompletion: "an anime answer",
                sourceName: "Example source",
                sourceUrl: "https://example.org/source",
            }],
        }));
        const conflictingRun = spawnSync(
            process.execPath,
            [scriptPath, "--game", "fact-or-cap-anime", filePath],
            { encoding: "utf8" }
        );
        assert.equal(conflictingRun.status, 1);
        assert.match(conflictingRun.stderr, /conflicts with an ID already in the question library/);
    });
    assert.equal(duplicateRun.status, 0);
    assert.match(duplicateRun.stderr, /missing source information/);
    assert.match(duplicateRun.stderr, /may duplicate library question "wombat-cubes"/);
    assert.equal(fs.existsSync(filePath), true);

    fs.writeFileSync(filePath, JSON.stringify({
        questions: [{
            id: "wombat-cubes",
            text: "Different prompt text",
            correctCompletion: "Different answer",
            sourceName: "Example source",
            sourceUrl: "https://example.org/source",
        }],
    }));
    const conflictRun = spawnSync(process.execPath, [scriptPath, filePath], {
        encoding: "utf8",
    });
    assert.equal(conflictRun.status, 1);
    assert.match(conflictRun.stderr, /conflicts with an ID already in the question library/);
});
