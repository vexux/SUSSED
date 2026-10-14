const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { buildQuestionBatchReview, formatTerminalReview, renderMarkdownReview } = require("../games/fake-answer/questionBatchReview");

const CLI = path.resolve(__dirname, "../games/fake-answer/scripts/review-question-batch.js");

function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-batch-review-"));
    const contentDirectories = {
        "fact-or-cap": path.join(root, "general"),
        "fact-or-cap-anime": path.join(root, "anime")
    };
    for (const directory of Object.values(contentDirectories)) fs.mkdirSync(directory);
    const inputPath = path.join(root, "candidate.json");
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { root, contentDirectories, inputPath };
}

function question(id, overrides = {}) {
    return {
        id,
        text: `A clear prompt for ${id} ends with ____.`,
        correctCompletion: `answer-${id}`,
        sourceName: "Example publisher",
        sourceUrl: "https://example.test/article",
        category: "science",
        tags: ["review"],
        difficulty: "medium",
        ...overrides
    };
}

function writeCandidate(workspace, questions, contentPackId = "candidate-pack") {
    fs.writeFileSync(workspace.inputPath, JSON.stringify({ contentPackId, questions }, null, 2));
}

function review(workspace, target = "fact-or-cap") {
    return buildQuestionBatchReview({
        target,
        inputPath: workspace.inputPath,
        contentDirectories: workspace.contentDirectories
    });
}

test("valid batch reports no automated warnings while keeping human review pending", (t) => {
    const workspace = setup(t);
    writeCandidate(workspace, [question("candidate-one")]);
    const report = review(workspace);
    assert.equal(report.candidateCount, 1);
    assert.equal(report.structurallyEligible, true);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.rows[0].flags, []);
    const terminal = formatTerminalReview(report);
    assert.match(terminal, /No automated warnings/);
    assert.match(terminal, /candidate-one/);
    assert.match(terminal, /Source name \/ URL/);
    assert.match(terminal, /https:\/\/example\.test\/article/);
    assert.match(terminal, /Questions requiring source\/factual review: 1 of 1/);
    assert.match(terminal, /does not inspect sources, verify facts, establish reuse rights/);
});

test("reports structural failures and duplicate IDs separately from normalized content matches", (t) => {
    const workspace = setup(t);
    fs.writeFileSync(path.join(workspace.contentDirectories["fact-or-cap"], "existing.json"), JSON.stringify({
        contentPackId: "existing",
        questions: [question("used-id", { text: "Shared prompt ____.", correctCompletion: "shared answer" })]
    }));
    writeCandidate(workspace, [
        question("used-id", { text: "shared prompt.", correctCompletion: "shared answer" }),
        { id: "incomplete", text: "Missing required answer." }
    ]);
    const report = review(workspace);
    assert.equal(report.structurallyEligible, false);
    assert.equal(report.duplicateIdCount, 1);
    assert.ok(report.duplicateMatches.length > 0);
    assert.ok(report.errors.some((error) => error.includes("requires a non-empty string")));
    assert.match(formatTerminalReview(report), /Duplicate question ID conflicts: 1/);
    assert.match(formatTerminalReview(report), /Exact\/normalized content matches:/);
});

test("surfaces missing, malformed, and non-HTTPS source metadata without asserting source support", (t) => {
    const workspace = setup(t);
    writeCandidate(workspace, [
        question("missing-source", { sourceName: "", sourceUrl: "" }),
        question("invalid-url", { sourceUrl: "not a URL" }),
        question("http-source", { sourceUrl: "http://example.test/page" })
    ]);
    const report = review(workspace);
    assert.equal(report.missingOrInvalidSourceCount, 2);
    assert.equal(report.nonHttpsSourceCount, 1);
    assert.ok(report.errors.some((error) => error.includes("invalid sourceUrl")));
    assert.ok(report.rows[0].flags.includes("source missing/incomplete"));
    assert.ok(report.rows[2].flags.includes("non-HTTPS source URL"));
    assert.match(formatTerminalReview(report), /URL is attribution only/);
});

test("supports Anime target through the shared review command", (t) => {
    const workspace = setup(t);
    writeCandidate(workspace, [question("anime-candidate")]);
    const report = review(workspace, "fact-or-cap-anime");
    assert.equal(report.target, "fact-or-cap-anime");
    assert.equal(report.structurallyEligible, true);
    assert.match(formatTerminalReview(report), /Target: fact-or-cap-anime/);
});

test("empty and malformed batches produce actionable hard failures", (t) => {
    const workspace = setup(t);
    writeCandidate(workspace, []);
    const empty = review(workspace);
    assert.equal(empty.candidateCount, 0);
    assert.equal(empty.structurallyEligible, false);
    assert.ok(empty.errors.some((error) => error.includes("at least one question")));
    fs.writeFileSync(workspace.inputPath, "null");
    const nonObject = review(workspace);
    assert.equal(nonObject.structurallyEligible, false);
    assert.ok(nonObject.errors.length > 0);
    fs.writeFileSync(workspace.inputPath, "{invalid json");
    const malformed = review(workspace);
    assert.equal(malformed.candidateCount, 0);
    assert.match(malformed.errors[0], /Unable to read candidate batch/);
    assert.match(formatTerminalReview(malformed), /Blocking validation\/import errors: 1/);
});

test("review is read-only and optional Markdown output is deterministic", (t) => {
    const workspace = setup(t);
    writeCandidate(workspace, [question("markdown-question")]);
    const runtimeDirectory = workspace.contentDirectories["fact-or-cap"];
    const beforeInput = fs.readFileSync(workspace.inputPath, "utf8");
    const beforeFiles = fs.readdirSync(runtimeDirectory).sort();
    const omittedPath = path.join(workspace.root, "omitted.md");
    const noOutput = spawnSync(process.execPath, [CLI, "--target", "fact-or-cap", "--input", workspace.inputPath], { encoding: "utf8" });
    assert.equal(noOutput.status, 0, noOutput.stderr);
    assert.equal(fs.existsSync(omittedPath), false);

    const outputPath = path.join(workspace.root, "review.md");
    const args = [CLI, "--target", "fact-or-cap", "--input", workspace.inputPath, "--output", outputPath];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const markdown = fs.readFileSync(outputPath, "utf8");
    const second = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(outputPath, "utf8"), markdown);
    assert.match(markdown, /\[Example publisher\]\(<https:\/\/example\.test\/article>\)/);
    assert.match(markdown, /Human review required/);
    assert.equal(fs.readFileSync(workspace.inputPath, "utf8"), beforeInput);
    assert.deepEqual(fs.readdirSync(runtimeDirectory).sort(), beforeFiles);
});

test("Markdown output preserves full prompts and source links", (t) => {
    const workspace = setup(t);
    writeCandidate(workspace, [question("full-prompt", { text: "A full prompt with all context ____." })]);
    const markdown = renderMarkdownReview(review(workspace));
    assert.match(markdown, /A full prompt with all context ____\./);
    assert.match(markdown, /https:\/\/example\.test\/article/);
});

test("explicit Markdown output cannot overwrite the candidate or ledger", (t) => {
    const workspace = setup(t);
    writeCandidate(workspace, [question("protected-input")]);
    const before = fs.readFileSync(workspace.inputPath, "utf8");
    const overwriteInput = spawnSync(process.execPath, [CLI, "--target", "fact-or-cap", "--input", workspace.inputPath, "--output", workspace.inputPath], { encoding: "utf8" });
    assert.equal(overwriteInput.status, 2);
    assert.match(overwriteInput.stderr, /must not overwrite the candidate input/);
    assert.equal(fs.readFileSync(workspace.inputPath, "utf8"), before);
    const ledgerPath = path.resolve(__dirname, "../games/fake-answer/research/general-topic-ledger.json");
    const ledgerBefore = fs.readFileSync(ledgerPath, "utf8");
    const overwriteLedger = spawnSync(process.execPath, [CLI, "--target", "fact-or-cap", "--input", workspace.inputPath, "--output", ledgerPath], { encoding: "utf8" });
    assert.equal(overwriteLedger.status, 2);
    assert.match(overwriteLedger.stderr, /Markdown \(\.md\)/);
    assert.equal(fs.readFileSync(ledgerPath, "utf8"), ledgerBefore);
});
