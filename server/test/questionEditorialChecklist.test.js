const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { renderQuestionEditorialChecklist } = require("../games/fake-answer/questionEditorialChecklist");

test("editorial checklist preserves candidate identity and separates automated signals from human review", () => {
    const candidate = {
        contentPackId: "pilot-pack",
        questions: [{
            id: "stable-id",
            text: "A precise prompt ____.",
            correctCompletion: "answer",
            category: "science",
            tags: ["space"],
            difficulty: "hard",
            sourceName: "Example publisher",
            sourceUrl: "https://example.test/item"
        }]
    };
    const preview = {
        target: "fact-or-cap",
        errors: [],
        warnings: ["Example validation warning"],
        duplicateMatches: [{
            candidateId: "stable-id",
            gameId: "fact-or-cap-anime",
            contentPackId: "anime-pack",
            existingQuestionId: "other-id",
            scope: "cross-bank"
        }]
    };
    const report = renderQuestionEditorialChecklist(candidate, preview);
    assert.match(report, /stable-id/);
    assert.match(report, /pilot-pack/);
    assert.match(report, /https:\/\/example\.test\/item/);
    assert.match(report, /fact-or-cap-anime\/anime-pack\/other-id \(cross-bank\)/);
    assert.match(report, /Source name and URL are attribution metadata only/);
    assert.match(report, /Claim-by-claim source support/);
    assert.match(report, /Rights\/reuse status: UNKNOWN/);
    assert.match(report, /metadata only; they do not establish claim support or reuse permission/);
    assert.equal(renderQuestionEditorialChecklist(candidate, preview), report);
});

test("editorial checklist CLI is read-only and reports the incoming question identity", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-editorial-checklist-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const packId = `editorial-check-${process.pid}`;
    const inputPath = path.join(root, "candidate.json");
    const original = `${JSON.stringify({
        contentPackId: packId,
        questions: [{
            id: `${packId}-question`,
            text: "Candidate prompt ____.",
            correctCompletion: "answer",
            sourceName: "Example source",
            sourceUrl: "https://example.test/fact"
        }]
    }, null, 2)}\n`;
    fs.writeFileSync(inputPath, original);
    const runtimeDirectory = path.resolve(__dirname, "../games/fake-answer/content");
    const filesBefore = fs.readdirSync(runtimeDirectory).sort();
    const result = spawnSync(process.execPath, [
        path.resolve(__dirname, "../games/fake-answer/scripts/generate-question-editorial-checklist.js"),
        "--target", "fact-or-cap", "--input", inputPath
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`${packId}-question`));
    assert.equal(fs.readFileSync(inputPath, "utf8"), original);
    assert.deepEqual(fs.readdirSync(runtimeDirectory).sort(), filesBefore);
});

test("editorial checklist still emits a packet when the batch pack ID is structurally invalid", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-editorial-invalid-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const inputPath = path.join(root, "candidate.json");
    fs.writeFileSync(inputPath, JSON.stringify({
        contentPackId: "INVALID PACK ID",
        questions: [{ id: "candidate-id", text: "A prompt", correctCompletion: "answer" }]
    }));
    const result = spawnSync(process.execPath, [
        path.resolve(__dirname, "../games/fake-answer/scripts/generate-question-editorial-checklist.js"),
        "--target", "fact-or-cap", "--input", inputPath
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Blocking structural\/ID\/import errors: 1/);
    assert.match(result.stdout, /INVALID PACK ID/);
    assert.match(result.stdout, /candidate-id/);
});

test("editorial checklist remains useful for incomplete metadata and arbitrary batch sizes", () => {
    const candidate = {
        contentPackId: "larger-pack",
        questions: Array.from({ length: 25 }, (_, index) => ({
            id: `question-${index + 1}`,
            text: `Prompt ${index + 1}`,
            correctCompletion: "answer"
        }))
    };
    const report = renderQuestionEditorialChecklist(candidate, {
        target: "fact-or-cap-anime",
        errors: ["Question 1 has an ID conflict."],
        warnings: [],
        duplicateMatches: []
    });
    assert.match(report, /Blocking structural\/ID\/import errors: 1/);
    assert.match(report, /Source name: ```\n\(not provided\)/);
    assert.match(report, /Source metadata present: no \/ incomplete/);
    assert.match(report, /UNKNOWN until separately assessed/);
    assert.match(report, /25\. ```\nquestion-25/);
    assert.doesNotMatch(report, /factually verified|rights-cleared|approved for publication/i);
});
