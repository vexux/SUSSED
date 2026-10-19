const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { buildGeneralTopicLedgerUpdate, writeLedgerAtomically } = require("../games/fact-or-cap/generalTopicLedgerMaintenance");
const { compareGeneralTopicLedger } = require("../games/fact-or-cap/generalTopicLedgerReport");

const CLI = path.resolve(__dirname, "../games/fact-or-cap/scripts/update-general-topic-ledger.js");

function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-ledger-maintenance-"));
    const contentDirectory = path.join(root, "content");
    fs.mkdirSync(contentDirectory);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const q1 = { id: "q-one", text: "Question one ____.", correctCompletion: "one", category: "science", tags: ["sample"], difficulty: "easy", sourceName: "Publisher", sourceUrl: "https://example.test/one" };
    const q2 = { id: "q-two", text: "Question two ____.", correctCompletion: "two", category: "science", tags: ["sample"], difficulty: "medium", sourceName: "Publisher", sourceUrl: "https://example.test/two" };
    const packPath = path.join(contentDirectory, "fixture-pack.json");
    fs.writeFileSync(packPath, JSON.stringify({ contentPackId: "fixture-pack", questions: [q1, q2] }, null, 2));
    const record = (question, type = "identification") => ({
        legacyIdentity: { gameId: "fact-or-cap", contentPackId: "fixture-pack", questionId: question.id },
        editorialClassification: { topicId: "science", subtopicId: "biology", questionType: type, underlyingClaimSummary: `Existing summary for ${question.id}.`, status: "provisional-editorial-classification", uncertaintyNote: null },
        legacyMetadata: { category: question.category, tags: question.tags, difficulty: question.difficulty },
        sourceReview: { attributionMetadataPresent: true, sourceName: question.sourceName, sourceUrl: question.sourceUrl, claimVerification: "not-assessed-by-this-ledger", claimSourceSupport: "not-assessed-by-this-ledger", rightsOrReuse: "unknown" }
    });
    const ledger = {
        ledgerVersion: 1,
        purpose: "test ledger",
        baselineSnapshot: {
            branch: "dev", commit: "test", snapshotDate: "2026-10-14", gameId: "fact-or-cap",
            publishedQuestionCount: 2, publishedContentPackCount: 1,
            contentPacks: [{ fileName: "fixture-pack.json", contentPackId: "fixture-pack", questionCount: 2 }],
            attributionMetadataPresentCount: 2, validationBasis: "fixture",
            editorialDistribution: { basis: "fixture", topicCounts: { science: 2 }, questionTypeCounts: { identification: 2, chronology: 0 } }
        },
        taxonomy: [{ topicId: "science", label: "Science", subtopics: ["biology", "physics"] }],
        classificationConventions: { questionTypes: ["identification", "chronology"] },
        questionRecords: [record(q1), record(q2, "chronology")],
        repetitionReviewClusters: [{ clusterId: "existing-cluster", questionIds: ["q-one", "q-two"], note: "Keep this human note.", status: "human-review-signal" }],
        suspectedSemanticDuplicates: [{ questionIds: ["q-one", "q-two"], note: "Unconfirmed overlap.", status: "needs-human-confirmation" }]
    };
    const q3 = { id: "q-three", text: "Question three ____.", correctCompletion: "three", category: "science", tags: ["new"], difficulty: "hard", sourceName: "New Source", sourceUrl: "https://example.test/three" };
    const classifications = {
        manifestVersion: 1,
        classifications: [{ contentPackId: "fixture-pack", questionId: "q-three", topicId: "science", subtopicId: "physics", questionType: "identification", underlyingClaimSummary: "Question three completes with three.", repetitionReview: { outcome: "no-known-overlap", note: "Compared against the current ledger; no likely repeated claim identified." } }]
    };
    return { root, contentDirectory, packPath, ledger, q1, q2, q3, classifications, record };
}

function publishQuestion(data, question = data.q3) {
    const pack = JSON.parse(fs.readFileSync(data.packPath, "utf8"));
    pack.questions.push(question);
    fs.writeFileSync(data.packPath, JSON.stringify(pack, null, 2));
}

test("adds a new published question using editor classifications and derived pack metadata", (t) => {
    const data = setup(t);
    publishQuestion(data);
    const result = buildGeneralTopicLedgerUpdate({ ledger: data.ledger, manifest: data.classifications, contentDirectory: data.contentDirectory });
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.addedRecords.length, 1);
    const added = result.addedRecords[0];
    assert.deepEqual(added.legacyIdentity, { gameId: "fact-or-cap", contentPackId: "fixture-pack", questionId: "q-three" });
    assert.deepEqual(added.legacyMetadata, { category: "science", tags: ["new"], difficulty: "hard" });
    assert.equal(added.sourceReview.sourceName, "New Source");
    assert.equal(added.sourceReview.sourceUrl, "https://example.test/three");
    assert.equal(added.sourceReview.claimVerification, "not-assessed-by-this-ledger");
    assert.equal(added.sourceReview.claimSourceSupport, "not-assessed-by-this-ledger");
    assert.equal(added.sourceReview.rightsOrReuse, "unknown");
    assert.equal(added.editorialClassification.status, "provisional-editorial-classification");
    assert.equal(result.updatedLedger.baselineSnapshot.publishedQuestionCount, 3);
    assert.equal(result.updatedLedger.baselineSnapshot.attributionMetadataPresentCount, 3);
    assert.equal(result.updatedLedger.baselineSnapshot.contentPacks[0].questionCount, 3);
    assert.equal(result.updatedLedger.baselineSnapshot.commit, "test");
    assert.equal(compareGeneralTopicLedger({ ledger: result.updatedLedger, contentDirectory: data.contentDirectory }).reconciliation.valid, true);
});

test("refuses missing classifications and unknown/invalid topic, subtopic, or question type", (t) => {
    const data = setup(t);
    publishQuestion(data);
    const missing = buildGeneralTopicLedgerUpdate({ ledger: data.ledger, manifest: { manifestVersion: 1, classifications: [] }, contentDirectory: data.contentDirectory });
    assert.equal(missing.valid, false);
    assert.ok(missing.errors.some((error) => error.includes("Missing editorial classification")));
    for (const change of [
        { topicId: "unknown", subtopicId: "physics" },
        { topicId: "science", subtopicId: "unknown" },
        { topicId: "science", subtopicId: "physics", questionType: "unknown" }
    ]) {
        const manifest = structuredClone(data.classifications);
        Object.assign(manifest.classifications[0], change);
        const result = buildGeneralTopicLedgerUpdate({ ledger: data.ledger, manifest, contentDirectory: data.contentDirectory });
        assert.equal(result.valid, false);
        assert.ok(result.errors.length > 0);
    }
});

test("rejects duplicate classification identities and preserves existing records and repetition notes", (t) => {
    const data = setup(t);
    publishQuestion(data);
    const manifest = structuredClone(data.classifications);
    manifest.classifications.push(structuredClone(manifest.classifications[0]));
    const duplicate = buildGeneralTopicLedgerUpdate({ ledger: data.ledger, manifest, contentDirectory: data.contentDirectory });
    assert.ok(duplicate.errors.some((error) => error.includes("Duplicate classification identity")));
    const valid = buildGeneralTopicLedgerUpdate({ ledger: data.ledger, manifest: data.classifications, contentDirectory: data.contentDirectory });
    assert.deepEqual(valid.updatedLedger.questionRecords.slice(0, 2), data.ledger.questionRecords);
    assert.deepEqual(valid.updatedLedger.repetitionReviewClusters, data.ledger.repetitionReviewClusters);
    assert.deepEqual(valid.updatedLedger.suspectedSemanticDuplicates, data.ledger.suspectedSemanticDuplicates);
});

test("refuses duplicate identities already present in the ledger", (t) => {
    const data = setup(t);
    data.ledger.questionRecords.push(structuredClone(data.ledger.questionRecords[0]));
    const result = buildGeneralTopicLedgerUpdate({ ledger: data.ledger, manifest: { manifestVersion: 1, classifications: [] }, contentDirectory: data.contentDirectory });
    assert.equal(result.valid, false);
    assert.equal(result.updatedLedger, null);
    assert.ok(result.errors.some((error) => error.includes("Duplicate existing ledger identity")));
});

test("refuses to overwrite an existing editorial classification or unresolved review note", (t) => {
    const data = setup(t);
    const manifest = structuredClone(data.classifications);
    manifest.classifications[0].questionId = "q-one";
    const overwrite = buildGeneralTopicLedgerUpdate({ ledger: data.ledger, manifest, contentDirectory: data.contentDirectory });
    assert.ok(overwrite.errors.some((error) => error.includes("would overwrite existing editorial record")));
    publishQuestion(data);
    const invalidNotes = structuredClone(data.classifications);
    invalidNotes.repetitionReviewClusters = [{ clusterId: "new-cluster", questionIds: ["not-published"], note: "Check this", status: "human-review-signal" }];
    const failed = buildGeneralTopicLedgerUpdate({ ledger: data.ledger, manifest: invalidNotes, contentDirectory: data.contentDirectory });
    assert.equal(failed.updatedLedger, null);
    assert.ok(failed.errors.some((error) => error.includes("missing or ambiguous")));
});

test("refuses to refresh snapshot fields when published changes exceed the new classified questions", (t) => {
    const data = setup(t);
    publishQuestion(data);
    const driftedLedger = structuredClone(data.ledger);
    driftedLedger.baselineSnapshot.attributionMetadataPresentCount = 1;
    const result = buildGeneralTopicLedgerUpdate({ ledger: driftedLedger, manifest: data.classifications, contentDirectory: data.contentDirectory });
    assert.equal(result.valid, false);
    assert.equal(result.updatedLedger, null);
    assert.ok(result.errors.some((error) => error.includes("attribution-count changes are not explained")));
});

test("reports malformed existing records and repetition-review metadata without throwing", (t) => {
    const data = setup(t);
    const malformedLedger = structuredClone(data.ledger);
    malformedLedger.questionRecords[0].editorialClassification.repetitionReview = { outcome: "approved", note: "" };
    malformedLedger.questionRecords.push(null);
    const result = buildGeneralTopicLedgerUpdate({ ledger: malformedLedger, manifest: { manifestVersion: 1, classifications: [] }, contentDirectory: data.contentDirectory });
    assert.equal(result.valid, false);
    assert.equal(result.updatedLedger, null);
    assert.ok(result.errors.some((error) => error.includes("invalid identity")));
    assert.ok(result.errors.some((error) => error.includes("repetitionReview requires")));
});

test("preview mode never writes and apply mode is idempotent", (t) => {
    const data = setup(t);
    publishQuestion(data);
    const ledgerPath = path.join(data.root, "ledger.json");
    const manifestPath = path.join(data.root, "classifications.json");
    fs.writeFileSync(ledgerPath, JSON.stringify(data.ledger, null, 2));
    fs.writeFileSync(manifestPath, JSON.stringify(data.classifications, null, 2));
    const original = fs.readFileSync(ledgerPath, "utf8");
    const args = [CLI, "--ledger", ledgerPath, "--content-dir", data.contentDirectory, "--classifications", manifestPath];
    const preview = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /PREVIEW \(read-only\)/);
    assert.equal(fs.readFileSync(ledgerPath, "utf8"), original);
    const apply = spawnSync(process.execPath, [...args, "--apply"], { encoding: "utf8" });
    assert.equal(apply.status, 0, apply.stderr);
    const once = fs.readFileSync(ledgerPath, "utf8");
    const repeated = spawnSync(process.execPath, [...args, "--apply"], { encoding: "utf8" });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(fs.readFileSync(ledgerPath, "utf8"), once);
    assert.match(repeated.stdout, /New ledger records: 0/);
});

test("apply CLI refuses invalid reconciliation without changing the ledger", (t) => {
    const data = setup(t);
    publishQuestion(data);
    const ledgerPath = path.join(data.root, "ledger.json");
    const manifestPath = path.join(data.root, "classifications.json");
    fs.writeFileSync(ledgerPath, JSON.stringify(data.ledger, null, 2));
    fs.writeFileSync(manifestPath, JSON.stringify({ manifestVersion: 1, classifications: [] }));
    const before = fs.readFileSync(ledgerPath, "utf8");
    const result = spawnSync(process.execPath, [CLI, "--ledger", ledgerPath, "--content-dir", data.contentDirectory, "--classifications", manifestPath, "--apply"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Ledger was not written/);
    assert.equal(fs.readFileSync(ledgerPath, "utf8"), before);
});

test("CLI refuses to use a runtime content pack as the ledger destination", (t) => {
    const data = setup(t);
    const before = fs.readFileSync(data.packPath, "utf8");
    const manifestPath = path.join(data.root, "classifications.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ manifestVersion: 1, classifications: [] }));
    const result = spawnSync(process.execPath, [CLI, "--ledger", data.packPath, "--content-dir", data.contentDirectory, "--classifications", manifestPath, "--apply"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to use a content directory/);
    assert.equal(fs.readFileSync(data.packPath, "utf8"), before);
});

test("atomic write failure leaves original ledger unchanged and cleans temporary files", (t) => {
    const data = setup(t);
    const ledgerPath = path.join(data.root, "ledger.json");
    fs.writeFileSync(ledgerPath, "original\n");
    const injectedFs = {
        openSync: (...args) => fs.openSync(...args),
        writeFileSync: (...args) => fs.writeFileSync(...args),
        fsyncSync: (...args) => fs.fsyncSync(...args),
        closeSync: (...args) => fs.closeSync(...args),
        existsSync: (...args) => fs.existsSync(...args),
        unlinkSync: (...args) => fs.unlinkSync(...args),
        renameSync: () => { throw new Error("simulated rename failure"); }
    };
    assert.throws(() => writeLedgerAtomically(ledgerPath, data.ledger, injectedFs), /simulated rename failure/);
    assert.equal(fs.readFileSync(ledgerPath, "utf8"), "original\n");
    assert.deepEqual(fs.readdirSync(data.root).filter((name) => name.endsWith(".tmp")), []);
});
