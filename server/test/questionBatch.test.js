const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
    formatReport,
    importBatch,
    inspectBatch,
    writeNewPackAtomically
} = require("../games/fake-answer/scripts/manage-question-batch");
const { loadQuestionPacks } = require("../games/fake-answer/questionLibrary");

const GENERAL_DIR = path.resolve(__dirname, "../games/fake-answer/content");
const ANIME_DIR = path.resolve(__dirname, "../games/fake-answer/content-anime");
const LIBRARIES = {
    "fact-or-cap": GENERAL_DIR,
    "fact-or-cap-anime": ANIME_DIR
};

function makeQuestion(id, overrides = {}) {
    return {
        id,
        text: `A fact about ${id} ends with ____.`,
        correctCompletion: `answer-${id}`,
        sourceName: "Example source",
        sourceUrl: "https://example.com/facts",
        category: "science",
        difficulty: "easy",
        tags: ["test"],
        ...overrides
    };
}

function makeWorkspace(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-question-batch-"));
    const directories = {
        "fact-or-cap": path.join(root, "general"),
        "fact-or-cap-anime": path.join(root, "anime")
    };
    fs.mkdirSync(directories["fact-or-cap"], { recursive: true });
    fs.mkdirSync(directories["fact-or-cap-anime"], { recursive: true });
    const inputPath = path.join(root, "candidate.json");
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { root, directories, inputPath };
}

function writeBatch(inputPath, questions, contentPackId = "candidate-pack") {
    fs.writeFileSync(inputPath, JSON.stringify({ contentPackId, questions }, null, 2));
}

test("both registered question libraries contain exactly 100 valid questions", () => {
    for (const [gameId, directory] of Object.entries(LIBRARIES)) {
        const result = loadQuestionPacks(directory);
        assert.equal(result.errors.length, 0, `${gameId} should have no validation errors`);
        assert.equal(result.warnings.length, 0, `${gameId} should have no duplicate-content warnings`);
        assert.equal(
            result.questions.length,
            100,
            `${gameId} should have the expected playable question count`
        );
        assert.equal(
            new Set(result.questions.map((question) => question.id)).size,
            result.questions.length,
            `${gameId} should have unique question IDs`
        );
        assert.ok(result.questions.every((question) => question.sourceName && question.sourceUrl));
    }
});

test("preview validates explicit target input without writing to a content library", (t) => {
    const workspace = makeWorkspace(t);
    writeBatch(workspace.inputPath, [makeQuestion("preview-question")]);
    const before = fs.readdirSync(workspace.directories["fact-or-cap"]);
    const report = inspectBatch({
        target: "fact-or-cap",
        inputPath: workspace.inputPath,
        contentDirectories: workspace.directories
    });
    assert.equal(report.canImport, true);
    assert.equal(report.questions.length, 1);
    assert.deepEqual(fs.readdirSync(workspace.directories["fact-or-cap"]), before);
    assert.throws(
        () => inspectBatch({
            target: "unknown",
            inputPath: workspace.inputPath,
            contentDirectories: workspace.directories
        }),
        /Unknown target/
    );
});

test("preview rejects invalid questions and duplicate IDs in either registered library", (t) => {
    const workspace = makeWorkspace(t);
    fs.writeFileSync(
        path.join(workspace.directories["fact-or-cap-anime"], "existing.json"),
        JSON.stringify({ contentPackId: "existing", questions: [makeQuestion("used-id")] })
    );
    writeBatch(workspace.inputPath, [makeQuestion("used-id"), { id: "incomplete" }]);
    const report = inspectBatch({
        target: "fact-or-cap",
        inputPath: workspace.inputPath,
        contentDirectories: workspace.directories
    });
    assert.equal(report.canImport, false);
    assert.deepEqual(report.crossLibraryConflicts, ["used-id"]);
    assert.ok(report.errors.some((error) => error.includes("requires a non-empty string")));
});

test("preview rejects questions without both source attribution fields", (t) => {
    const workspace = makeWorkspace(t);
    const question = makeQuestion("unattributed-question");
    delete question.sourceUrl;
    writeBatch(workspace.inputPath, [question]);
    const report = inspectBatch({
        target: "fact-or-cap",
        inputPath: workspace.inputPath,
        contentDirectories: workspace.directories
    });
    assert.equal(report.canImport, false);
    assert.ok(report.errors.some((error) => error.includes("sourceName and sourceUrl")));
});

test("likely duplicate content requires explicit import approval", (t) => {
    const workspace = makeWorkspace(t);
    fs.writeFileSync(
        path.join(workspace.directories["fact-or-cap"], "existing.json"),
        JSON.stringify({
            contentPackId: "existing",
            questions: [makeQuestion("old-question", { text: "A prompt with ____. ", correctCompletion: "answer" })]
        })
    );
    writeBatch(workspace.inputPath, [
        makeQuestion("new-question", { text: "A prompt with ____.", correctCompletion: "answer" })
    ]);
    const options = {
        target: "fact-or-cap",
        inputPath: workspace.inputPath,
        contentDirectories: workspace.directories
    };
    const report = inspectBatch(options);
    assert.equal(report.canImport, true);
    assert.equal(report.duplicateContent.length, 1);
    assert.match(formatReport(report), /Pending explicit duplicate-content approval: 1/);
    assert.throws(() => importBatch(options), /explicit --allow-likely-duplicates approval/);
    assert.equal(fs.existsSync(report.destination), false);
    assert.equal(importBatch({ ...options, allowLikelyDuplicates: true }).imported, 1);
});

test("imports never overwrite an existing pack and repeated imports are rejected", (t) => {
    const workspace = makeWorkspace(t);
    writeBatch(workspace.inputPath, [makeQuestion("new-question")]);
    const options = {
        target: "fact-or-cap",
        inputPath: workspace.inputPath,
        contentDirectories: workspace.directories
    };
    const first = importBatch(options);
    const originalContents = fs.readFileSync(first.destination, "utf8");
    assert.equal(first.imported, 1);
    assert.equal(first.rejected, 0);
    assert.throws(() => importBatch(options), /never overwrite packs/);
    assert.equal(fs.readFileSync(first.destination, "utf8"), originalContents);
});

test("competing imports cannot overwrite the same destination", async (t) => {
    const workspace = makeWorkspace(t);
    writeBatch(workspace.inputPath, [makeQuestion("concurrent-question")]);
    const options = {
        target: "fact-or-cap",
        inputPath: workspace.inputPath,
        contentDirectories: workspace.directories
    };
    const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => importBatch(options)),
        Promise.resolve().then(() => importBatch(options))
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
    assert.equal(fs.readdirSync(workspace.directories["fact-or-cap"]).length, 1);
});

test("failed atomic writes clean up their temporary file and report the failure", (t) => {
    const workspace = makeWorkspace(t);
    const destination = path.join(workspace.directories["fact-or-cap"], "failed.json");
    const failingFileSystem = new Proxy(fs, {
        get(target, property) {
            if (property === "linkSync") {
                return () => {
                    const error = new Error("simulated link failure");
                    error.code = "EIO";
                    throw error;
                };
            }
            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
        }
    });
    assert.throws(
        () => writeNewPackAtomically(destination, "{}", failingFileSystem),
        /simulated link failure/
    );
    assert.deepEqual(fs.readdirSync(workspace.directories["fact-or-cap"]), []);
});

test("reports a completed import if only temporary-link cleanup fails", (t) => {
    const workspace = makeWorkspace(t);
    writeBatch(workspace.inputPath, [makeQuestion("cleanup-question")]);
    let failTemporaryCleanup = true;
    const fileSystem = new Proxy(fs, {
        get(target, property) {
            if (property === "unlinkSync") {
                return (filePath) => {
                    if (failTemporaryCleanup && filePath.endsWith(".tmp")) {
                        failTemporaryCleanup = false;
                        throw new Error("simulated cleanup failure");
                    }
                    return target.unlinkSync(filePath);
                };
            }
            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
        }
    });
    const report = importBatch({
        target: "fact-or-cap",
        inputPath: workspace.inputPath,
        contentDirectories: workspace.directories,
        fileSystem
    });
    assert.equal(report.imported, 1);
    assert.equal(report.rejected, 0);
    assert.ok(report.warnings.some((warning) => warning.includes("temporary file could not be removed")));
    for (const fileName of fs.readdirSync(workspace.directories["fact-or-cap"])) {
        if (fileName.endsWith(".tmp")) {
            fs.unlinkSync(path.join(workspace.directories["fact-or-cap"], fileName));
        }
    }
});
