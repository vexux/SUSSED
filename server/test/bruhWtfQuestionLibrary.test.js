const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
    loadQuestionPacks,
    validateQuestionLibrary,
    validateQuestionPack
} = require("../games/bruh-wtf/questionLibrary");
const { main } = require("../games/bruh-wtf/validate-question-pack");

const contentDirectory = path.join(__dirname, "../games/bruh-wtf/content");
const validatorPath = path.join(__dirname, "../games/bruh-wtf/validate-question-pack.js");
const fixture = JSON.parse(fs.readFileSync(path.join(contentDirectory, "development-fixtures.json"), "utf8"));

function pack(id, questionId, prompt = "What happens to {{player1}}?") {
    return {
        formatVersion: 1,
        contentPackId: id,
        packType: "production",
        questions: [{ id: questionId, prompt, requiredPlayers: 1, category: "ordinary-life", tags: ["target-one"], contentPackId: id }]
    };
}

test("development fixtures remain valid under the version 1 canonical taxonomy", () => {
    assert.equal(fixture.questions.length, 11);
    assert.deepEqual(validateQuestionPack(fixture, "development-fixtures.json").errors, []);
    assert.equal(loadQuestionPacks(contentDirectory).filter(({ contentPackId }) => contentPackId === "bruh-wtf-development-fixtures").length, 11);
});

test("production batches load automatically beside development fixtures", () => {
    const loaded = loadQuestionPacks(contentDirectory);
    const batchOne = loaded.filter(({ contentPackId }) => contentPackId === "bruh-wtf-production-batch-001");
    const batchTwo = loaded.filter(({ contentPackId }) => contentPackId === "bruh-wtf-production-batch-002");
    const batchThree = loaded.filter(({ contentPackId }) => contentPackId === "bruh-wtf-production-batch-003");
    assert.equal(batchOne.length, 25);
    assert.equal(batchTwo.length, 50);
    assert.equal(batchThree.length, 50);
    assert.equal(loaded.length, 136);
    assert.ok(batchOne.every(({ id }) => id.startsWith("bruh-b001-")));
    assert.ok(batchTwo.length > 0);
    assert.ok(batchThree.every(({ id }) => id.startsWith("bruh-b003-")));
});

test("pack and question IDs, categories, tags, and nonempty question arrays are enforced", () => {
    const invalids = [
        [{ formatVersion: 1, packType: "production", questions: [pack("valid-pack", "valid-id").questions[0]] }, /contentPackId must use stable lowercase kebab-case/u],
        [pack("Bad_ID", "valid-id"), /contentPackId.*kebab-case/u],
        [pack("valid-pack", "Bad_ID"), /id must use stable lowercase kebab-case/u],
        [{ ...pack("valid-pack", "valid-id"), questions: [{ ...pack("valid-pack", "valid-id").questions[0], category: "what-if" }] }, /unsupported category/u],
        [{ ...pack("valid-pack", "valid-id"), questions: [{ ...pack("valid-pack", "valid-id").questions[0], tags: ["duo"] }] }, /unsupported tag/u],
        [{ ...pack("valid-pack", "valid-id"), questions: [] }, /at least one question/u],
        [{ ...pack("valid-pack", "valid-id"), questions: [{ ...pack("valid-pack", "valid-id").questions[0], contentPackId: "other" }] }, /contentPackId must match/u]
    ];
    for (const [data, expected] of invalids) {
        assert.match(validateQuestionPack(data, "valid-pack.json").errors.join("\n"), expected);
    }
});

test("library validation blocks duplicate IDs and normalized prompts across packs", () => {
    const result = validateQuestionLibrary([
        { fileName: "first.json", data: pack("first", "same-id", "Hello {{player1}}?") },
        { fileName: "second.json", data: pack("second", "same-id", "  HELLO   {{player1}}?  ") }
    ]);
    assert.match(result.errors.join("\n"), /second\.json: question "same-id" duplicates an ID/u);
    assert.match(result.errors.join("\n"), /second\.json: question "same-id" duplicates a normalized prompt/u);
});

test("runtime loading rejects an empty library", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-bruh-empty-library-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    assert.throws(() => loadQuestionPacks(directory), /no JSON question packs found/u);
});

test("runtime loading applies the same category and text rules as the validator", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-bruh-invalid-runtime-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const invalidPack = pack("invalid-pack", "invalid-question", "Misato?s turn {{player1}}");
    fs.writeFileSync(path.join(directory, "invalid-pack.json"), JSON.stringify(invalidPack));
    const validation = validateQuestionPack(invalidPack, "invalid-pack.json");
    assert.ok(validation.errors.some((error) => error.includes("text-integrity substring")));
    assert.throws(() => loadQuestionPacks(directory), /text-integrity substring/u);
});

test("all-pack validation succeeds and is read-only", () => {
    const before = fs.readdirSync(contentDirectory).sort().map((file) => [
        file,
        fs.statSync(path.join(contentDirectory, file)).mtimeMs,
        createHash("sha256").update(fs.readFileSync(path.join(contentDirectory, file))).digest("hex")
    ]);
    const run = spawnSync(process.execPath, [validatorPath, "--all"], { encoding: "utf8", cwd: path.join(__dirname, "../..") });
    const after = fs.readdirSync(contentDirectory).sort().map((file) => [
        file,
        fs.statSync(path.join(contentDirectory, file)).mtimeMs,
        createHash("sha256").update(fs.readFileSync(path.join(contentDirectory, file))).digest("hex")
    ]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Validated 4 Bruh wtf\? pack\(s\) and 136 question\(s\)/u);
    assert.deepEqual(after, before);
});

test("individual CLI mode remains available and reports actionable validation errors", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-bruh-validator-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const validPath = path.join(directory, "pilot-pack.json");
    fs.writeFileSync(validPath, JSON.stringify(pack("pilot-pack", "candidate-one")));
    const valid = spawnSync(process.execPath, [validatorPath, validPath], { encoding: "utf8" });
    assert.equal(valid.status, 0, valid.stderr);

    const duplicatePath = path.join(directory, "duplicate-pack.json");
    const duplicate = pack("duplicate-pack", "different-id", "What would {{player1}} do if they got one wish granted?");
    fs.writeFileSync(duplicatePath, JSON.stringify(duplicate));
    const duplicateRun = spawnSync(process.execPath, [validatorPath, duplicatePath], { encoding: "utf8" });
    assert.equal(duplicateRun.status, 1);
    assert.match(duplicateRun.stderr, /normalized prompt/u);

    const invalidPath = path.join(directory, "invalid-pack.json");
    fs.writeFileSync(invalidPath, JSON.stringify(pack("invalid-pack", "bad-id", "Misato?s turn {{player1}}?")));
    const invalid = spawnSync(process.execPath, [validatorPath, invalidPath], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /invalid-pack\.json: question "bad-id".*"Misato\?s"/u);

    const malformedPath = path.join(directory, "bad-utf8.json");
    fs.writeFileSync(malformedPath, Buffer.from([0x7b, 0xc3, 0x28, 0x7d]));
    const malformed = spawnSync(process.execPath, [validatorPath, malformedPath], { encoding: "utf8" });
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /bad-utf8\.json.*invalid UTF-8/u);
});

test("all-pack CLI mode fails with filename and question ID for blocking errors", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-bruh-all-validator-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const invalidPack = pack("bad-pack", "bad-question");
    invalidPack.questions[0].category = "unlisted-category";
    fs.writeFileSync(path.join(directory, "bad-pack.json"), JSON.stringify(invalidPack));
    const messages = [];
    const result = main(["--all"], { log: (line) => messages.push(line), error: (line) => messages.push(line) }, directory);
    assert.equal(result, 1);
    assert.match(messages.join("\n"), /bad-pack\.json: question "bad-question" has unsupported category/u);
});
