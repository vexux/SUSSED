const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { compareGeneralTopicLedger } = require("../games/fact-or-cap/generalTopicLedgerReport");
const {
    DEFAULT_PATHS,
    cleanupCandidate,
    cleanupEligibility,
    cleanupFranchiseManifest,
    cleanupFranchiseManifestEligibility,
    createReview,
    formatReview,
    makeAnimeLedgerUpdate,
    publishBatch,
    recoverPublication,
    sha256
} = require("../games/fact-or-cap/contentPublication");

function question(id, text = `A question about ${id} ____?`, completion = id) {
    return { id, text, correctCompletion: completion, category: "science", tags: ["fixture"], difficulty: "medium", sourceName: "Test source", sourceUrl: `https://example.test/${id}` };
}

test("default publication evidence is stored outside the repository", () => {
    const researchDirectory = path.resolve(__dirname, "../games/fact-or-cap/research");
    const relative = path.relative(researchDirectory, path.resolve(DEFAULT_PATHS.temporaryEvidenceDirectory));
    assert.ok(relative.startsWith("..") || path.isAbsolute(relative));
    assert.ok(path.resolve(DEFAULT_PATHS.temporaryEvidenceDirectory).startsWith(path.resolve(os.tmpdir())));
});

test("publication cannot recreate a report archive inside repository research", (t) => {
    const data = setup(t);
    const reviewed = data.review();
    const approval = data.approvalFor(reviewed);
    const archivePath = path.join(data.root, "research", "publication-reports", `${data.contentPackId}.json`);
    assert.throws(() => publishBatch({
        review: reviewed,
        approval,
        classificationManifest: data.classificationManifest,
        paths: data.paths,
        contentDirectories: data.contentDirectories,
        receiptPath: archivePath
    }), /Temporary publication receipt must be stored/);
    assert.equal(fs.existsSync(path.dirname(archivePath)), false);
    assert.equal(fs.existsSync(path.join(data.generalDirectory, `${data.contentPackId}.json`)), false);
});

function ledgerRecord(q, packId) {
    return {
        legacyIdentity: { gameId: "fact-or-cap", contentPackId: packId, questionId: q.id },
        editorialClassification: { topicId: "science", subtopicId: "biology", questionType: "identification", underlyingClaimSummary: `Claim for ${q.id}.`, status: "provisional-editorial-classification", uncertaintyNote: null, repetitionReview: { outcome: "no-known-overlap", note: "Fixture comparison." } },
        legacyMetadata: { category: q.category, tags: q.tags, difficulty: q.difficulty },
        sourceReview: { attributionMetadataPresent: true, sourceName: q.sourceName, sourceUrl: q.sourceUrl, claimVerification: "not-assessed-by-this-ledger", claimSourceSupport: "not-assessed-by-this-ledger", rightsOrReuse: "unknown" }
    };
}

function generalLedger(existing, packId) {
    return {
        ledgerVersion: 1,
        purpose: "publication pipeline fixture",
        baselineSnapshot: {
            branch: "test", commit: "fixture", snapshotDate: "2026-10-19", gameId: "fact-or-cap",
            publishedQuestionCount: existing.length, publishedContentPackCount: 1,
            contentPacks: [{ fileName: `${packId}.json`, contentPackId: packId, questionCount: existing.length }],
            attributionMetadataPresentCount: existing.length,
            editorialDistribution: { basis: "fixture", topicCounts: { science: existing.length }, questionTypeCounts: { identification: existing.length } }
        },
        taxonomy: [{ topicId: "science", label: "Science", subtopics: ["biology", "physics"] }],
        classificationConventions: { questionTypes: ["identification"] },
        questionRecords: existing.map((q) => ledgerRecord(q, packId)),
        repetitionReviewClusters: [],
        suspectedSemanticDuplicates: []
    };
}

function setup(t, { questions = [question("old-one"), question("old-two", "A second fact ____?", "two")], target = "fact-or-cap" } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-publication-"));
    const generalDirectory = path.join(root, "content", "general");
    const animeDirectory = path.join(root, "content", "anime");
    const incoming = path.join(root, "incoming");
    const temporaryEvidence = path.join(root, "temporary-evidence");
    const transactions = path.join(root, ".publication-recovery");
    fs.mkdirSync(generalDirectory, { recursive: true });
    fs.mkdirSync(animeDirectory, { recursive: true });
    fs.mkdirSync(incoming, { recursive: true });
    fs.mkdirSync(temporaryEvidence, { recursive: true });
    const generalPack = { contentPackId: "fixture-general", questions };
    fs.writeFileSync(path.join(generalDirectory, "fixture-general.json"), `${JSON.stringify(generalPack, null, 2)}\n`);
    const ledgerPath = path.join(root, "research", "general-topic-ledger.json");
    const animeLedgerPath = path.join(root, "research", "anime-franchise-ledger.json");
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, `${JSON.stringify(generalLedger(questions, "fixture-general"), null, 2)}\n`);
    fs.writeFileSync(animeLedgerPath, `${JSON.stringify({ ledgerVersion: 1, bankSnapshot: { questionCount: 0, contentPackCount: 0 }, franchises: [] }, null, 2)}\n`);
    const inputPath = path.join(incoming, "candidate.json");
    const contentPackId = "fixture-new-pack";
    const candidate = { contentPackId, questions: [question("new-one")] };
    fs.writeFileSync(inputPath, `${JSON.stringify(candidate, null, 2)}\n`);
    const classificationManifest = {
        manifestVersion: 1,
        classifications: [{ contentPackId, questionId: "new-one", topicId: "science", subtopicId: "physics", questionType: "identification", underlyingClaimSummary: "The new fixture claim.", repetitionReview: { outcome: "no-known-overlap", note: "Compared with fixture claims." } }]
    };
    const classificationPath = path.join(root, "classifications.json");
    fs.writeFileSync(classificationPath, `${JSON.stringify(classificationManifest, null, 2)}\n`);
    const franchisePath = path.join(root, "franchises.json");
    const paths = { generalLedger: ledgerPath, animeLedger: animeLedgerPath, incomingDirectory: incoming, temporaryEvidenceDirectory: temporaryEvidence, transactionDirectory: transactions };
    const contentDirectories = { "fact-or-cap": generalDirectory, "fact-or-cap-anime": animeDirectory };
    const review = (changes = {}) => createReview({ target, inputPath, ...(target === "fact-or-cap" ? { classificationPath } : { franchisePath }), paths, contentDirectories, ...changes });
    const approvalFor = (currentReview, outcomes = {}) => ({
        approvalVersion: 1,
        target,
        contentPackId,
        candidateSha256: currentReview.report.candidateSha256,
        ledgerMetadataSha256: currentReview.report.ledgerMetadataSha256,
        reviewerId: "editor-test",
        approvedAt: "2026-10-19T12:00:00.000Z",
        rationale: "Reviewed the candidate, duplicate signals, and intended content changes.",
        decisions: currentReview.candidateQuestions.map(({ id }) => ({ questionId: id, outcome: outcomes[id] ?? "publish" }))
    });
    const publish = (currentReview, approval = approvalFor(currentReview), extra = {}) => publishBatch({
        review: currentReview,
        approval,
        classificationManifest,
        paths,
        contentDirectories,
        receiptPath: path.join(temporaryEvidence, `${contentPackId}.json`),
        ...extra
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { root, generalDirectory, animeDirectory, incoming, temporaryEvidence, transactions, ledgerPath, animeLedgerPath, inputPath, candidate, questions, contentPackId, classificationManifest, classificationPath, franchisePath, paths, contentDirectories, review, approvalFor, publish };
}

function replaceCandidate(data, candidate) {
    data.candidate = candidate;
    fs.writeFileSync(data.inputPath, `${JSON.stringify(candidate, null, 2)}\n`);
}

test("valid new General batch reports destination, question IDs, and required ledger metadata", (t) => {
    const data = setup(t);
    const result = data.review();
    assert.equal(result.report.blockers.length, 0);
    assert.equal(result.report.publicationEligible, true);
    assert.equal(result.report.proposedDestination, path.join(data.generalDirectory, "fixture-new-pack.json"));
    assert.deepEqual(result.report.newQuestionIds, ["new-one"]);
    assert.equal(result.report.ledger.status, "valid-current-snapshot");
});

test("missing required question fields block publication with question context", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [{ id: "broken", text: "Missing answer ____?" }] });
    assert.ok(data.review().report.blockers.some((item) => item.includes("broken") && item.includes("correctCompletion")));
});

test("missing source attribution is surfaced and blocks publication", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [{ id: "no-source", text: "A prompt ____?", correctCompletion: "answer", category: "science", tags: [], difficulty: "medium" }] });
    const report = data.review().report;
    assert.ok(report.blockers.some((item) => item.includes("sourceName and sourceUrl")));
    assert.ok(report.warnings.some((item) => item.includes("missing source information")));
    assert.equal(report.publicationEligible, false);
});

test("malformed questions are reported without crashing duplicate analysis", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [null, { id: "broken", text: 42, correctCompletion: null }] });
    const result = data.review().report;
    assert.ok(result.blockers.some((item) => item.includes("broken")));
    assert.equal(result.publicationEligible, false);
});

test("unreadable candidate reports remain printable and actionable", (t) => {
    const data = setup(t);
    const result = createReview({ target: "fact-or-cap", inputPath: path.join(data.root, "missing.json"), paths: data.paths, contentDirectories: data.contentDirectories });
    assert.match(formatReview(result.report), /Unable to read candidate batch/);
    assert.equal(result.report.publicationEligible, false);
});

test("duplicate candidate IDs are reported and block the complete batch", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [question("dup"), question("dup", "Different prompt ____?", "x")] });
    const result = data.review().report;
    assert.ok(result.blockers.some((item) => item.includes("duplicates question ID")));
    assert.equal(result.publicationEligible, false);
});

test("exact duplicate prompts and answers identify the existing pack and question", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [question("new-id", data.questions[0].text, data.questions[0].correctCompletion)] });
    const report = data.review().report;
    assert.equal(report.exactDuplicates[0].existingQuestionId, "old-one");
    assert.equal(report.exactDuplicates[0].existingPackId, "fixture-general");
    assert.equal(report.normalizedDuplicates.length, 0);
});

test("same ID with identical substantive content is classified as already published", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [structuredClone(data.questions[0])] });
    const report = data.review().report;
    assert.equal(report.sameIdIdentical[0].candidateId, "old-one");
    assert.deepEqual(report.conflictingIds, []);
});

test("same ID with changed content blocks publication and lists differing fields", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [{ ...data.questions[0], correctCompletion: "changed" }] });
    const report = data.review().report;
    assert.deepEqual(report.conflictingIds[0].fields, ["correctCompletion"]);
    assert.ok(report.blockers.some((item) => item.includes("conflicts with published content")));
});

test("question IDs already present in the other registered bank block publication", (t) => {
    const data = setup(t);
    const otherBankQuestion = question("cross-bank-id", "A fact unique to the Anime bank ____?", "answer");
    fs.writeFileSync(path.join(data.animeDirectory, "fixture-anime.json"), `${JSON.stringify({ contentPackId: "fixture-anime", questions: [otherBankQuestion] }, null, 2)}\n`);
    replaceCandidate(data, { ...data.candidate, questions: [question("cross-bank-id")] });
    const report = data.review().report;
    assert.ok(report.blockers.some((item) => item.includes("already used by the other registered content bank")));
    assert.equal(report.publicationEligible, false);
});

test("normalized prompt and answer matches remain review warnings and require distinct rationale", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [question("new-id", ` ${data.questions[0].text.toUpperCase()} `, data.questions[0].correctCompletion.toUpperCase())] });
    const initial = data.review();
    assert.equal(initial.report.normalizedDuplicates.length, 1);
    assert.equal(initial.report.semanticReview.status, "not-automated");
    const badApproval = data.approvalFor(initial, { "new-id": "publish" });
    assert.throws(() => data.publish(initial, badApproval), /publish-distinct, exclude/);
    const approval = data.approvalFor(initial, { "new-id": "publish-distinct" });
    approval.decisions[0].rationale = "The completion is a distinct, independently reviewed claim.";
    data.classificationManifest.classifications.push({ ...data.classificationManifest.classifications[0], questionId: "new-id", underlyingClaimSummary: "A distinct fixture claim with a normalized wording match." });
    fs.writeFileSync(data.classificationPath, `${JSON.stringify(data.classificationManifest, null, 2)}\n`);
    const reviewed = data.review();
    const updatedApproval = data.approvalFor(reviewed, { "new-id": "publish-distinct" });
    updatedApproval.decisions[0].rationale = approval.decisions[0].rationale;
    const result = data.publish(reviewed, updatedApproval);
    assert.deepEqual(result.pack.questions.map(({ id }) => id), ["new-id"]);
});

test("human semantic similarity is never claimed by normalization", (t) => {
    const data = setup(t);
    const report = data.review().report;
    assert.equal(report.semanticReview.status, "not-automated");
    assert.match(report.semanticReview.note, /Human review is required/);
});

test("a published General question missing from the ledger blocks publication", (t) => {
    const data = setup(t);
    const ledger = JSON.parse(fs.readFileSync(data.ledgerPath, "utf8"));
    ledger.questionRecords.pop();
    fs.writeFileSync(data.ledgerPath, JSON.stringify(ledger));
    assert.ok(data.review().report.blockers.some((item) => item.includes("missing from ledger")));
});

test("stale General ledger memberships block publication", (t) => {
    const data = setup(t);
    const ledger = JSON.parse(fs.readFileSync(data.ledgerPath, "utf8"));
    ledger.questionRecords[0].legacyIdentity.questionId = "removed";
    fs.writeFileSync(data.ledgerPath, JSON.stringify(ledger));
    assert.ok(data.review().report.blockers.some((item) => item.includes("no longer exists in published packs")));
});

test("Anime publication requires explicit franchise metadata", (t) => {
    const data = setup(t, { target: "fact-or-cap-anime" });
    const result = data.review();
    assert.ok(result.report.warnings.some((item) => item.includes("Unable to read Anime franchise manifest")));
    const current = JSON.parse(fs.readFileSync(data.animeLedgerPath, "utf8"));
    const pack = { contentPackId: "fixture-new-pack", questions: [question("new-one")] };
    const metadata = makeAnimeLedgerUpdate(current, { manifestVersion: 1, franchises: [], entries: [] }, pack, []);
    assert.ok(metadata.errors.some((item) => item.includes("Missing required Anime franchise assignment")));
});

test("Anime publication writes a pack and explicitly reconciled franchise ledger", (t) => {
    const data = setup(t, { target: "fact-or-cap-anime" });
    const manifest = {
        manifestVersion: 1,
        franchises: [{ franchiseId: "fixture-series", displayName: "Fixture Series", aliases: [] }],
        entries: [{ questionId: "new-one", franchiseId: "fixture-series" }]
    };
    fs.writeFileSync(data.franchisePath, `${JSON.stringify(manifest, null, 2)}\n`);
    const reviewed = data.review();
    const approval = data.approvalFor(reviewed);
    const result = publishBatch({
        review: reviewed,
        approval,
        animeFranchiseManifest: manifest,
        paths: data.paths,
        contentDirectories: data.contentDirectories,
        receiptPath: path.join(data.temporaryEvidence, `${data.contentPackId}.json`)
    });
    const ledger = JSON.parse(fs.readFileSync(data.animeLedgerPath, "utf8"));
    assert.deepEqual(result.pack.questions.map(({ id }) => id), ["new-one"]);
    assert.equal(ledger.bankSnapshot.questionCount, 1);
    assert.deepEqual(ledger.franchises[0].packMemberships[0].questionIds, ["new-one"]);
    assert.equal(JSON.parse(fs.readFileSync(result.receipt.destination, "utf8")).questions.length, 1);
});

test("unresolved same-ID conflict cannot be cleared by an approval file", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [{ ...data.questions[0], text: "Conflicting prompt ____?" }] });
    const reviewed = data.review();
    assert.throws(() => data.publish(reviewed, data.approvalFor(reviewed)), /conflicts with published content/);
});

test("publication rejects classification metadata changed after review", (t) => {
    const data = setup(t);
    const reviewed = data.review();
    const approval = data.approvalFor(reviewed);
    data.classificationManifest.classifications[0].underlyingClaimSummary = "Changed after the review was approved.";
    assert.throws(() => data.publish(reviewed, approval), /manifest changed after review/);
});

test("review is read-only for candidate, published pack, and ledger", (t) => {
    const data = setup(t);
    const before = [data.inputPath, path.join(data.generalDirectory, "fixture-general.json"), data.ledgerPath].map((file) => fs.readFileSync(file));
    data.review();
    const after = [data.inputPath, path.join(data.generalDirectory, "fixture-general.json"), data.ledgerPath].map((file) => fs.readFileSync(file));
    before.forEach((value, index) => assert.deepEqual(after[index], value));
    assert.equal(fs.existsSync(path.join(data.generalDirectory, "fixture-new-pack.json")), false);
});

test("explicit publication writes only approved additions and reconciles the General ledger", (t) => {
    const data = setup(t);
    const reviewed = data.review();
    const result = data.publish(reviewed);
    const published = JSON.parse(fs.readFileSync(result.receipt.destination, "utf8"));
    const ledger = JSON.parse(fs.readFileSync(data.ledgerPath, "utf8"));
    assert.deepEqual(published.questions.map(({ id }) => id), ["new-one"]);
    assert.equal(compareGeneralTopicLedger({ ledger, contentDirectory: data.generalDirectory }).reconciliation.valid, true);
    assert.equal(JSON.parse(fs.readFileSync(result.receiptPath, "utf8")).status, "published");
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8"));
    assert.equal(receipt.ledgerReconciliation.status, "passed");
    assert.equal(receipt.reviewReport.candidateSha256, reviewed.report.candidateSha256);
});

test("repeating the same batch cannot overwrite or duplicate a published pack", (t) => {
    const data = setup(t);
    const before = data.publish(data.review());
    const packBytes = fs.readFileSync(before.receipt.destination);
    assert.ok(data.review().report.blockers.some((item) => item.includes("already exists")));
    const reviewedAgain = data.review();
    const approval = data.approvalFor(reviewedAgain, { "new-one": "already-published" });
    assert.throws(() => data.publish(reviewedAgain, approval), /already exists/);
    assert.deepEqual(fs.readFileSync(before.receipt.destination), packBytes);
});

test("multi-file write failure removes the pack and preserves the original ledger", (t) => {
    const data = setup(t);
    const reviewed = data.review();
    const approval = data.approvalFor(reviewed);
    const beforeLedger = fs.readFileSync(data.ledgerPath);
    let failed = false;
    const injected = new Proxy(fs, { get(target, property) { if (property === "renameSync") return (...args) => { if (!failed && args[1] === data.ledgerPath) { failed = true; throw new Error("simulated ledger replacement failure"); } return target.renameSync(...args); }; const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } });
    assert.throws(() => publishBatch({ review: reviewed, approval, classificationManifest: data.classificationManifest, paths: data.paths, contentDirectories: data.contentDirectories, receiptPath: path.join(data.temporaryEvidence, "fixture-new-pack.json"), fileSystem: injected }), /rolled back/);
    assert.equal(fs.existsSync(path.join(data.generalDirectory, "fixture-new-pack.json")), false);
    assert.deepEqual(fs.readFileSync(data.ledgerPath), beforeLedger);
    assert.equal(fs.existsSync(path.join(data.transactions, "transaction.json")), false);
});

test("staging failure is journaled and leaves published targets untouched", (t) => {
    const data = setup(t);
    const reviewed = data.review();
    const approval = data.approvalFor(reviewed);
    const beforeLedger = fs.readFileSync(data.ledgerPath);
    let failed = false;
    const injected = new Proxy(fs, { get(target, property) {
        if (property === "openSync") return (filePath, ...args) => {
            if (!failed && String(filePath).includes("fixture-new-pack.json") && String(filePath).endsWith(".tmp")) { failed = true; throw new Error("simulated staging failure"); }
            return target.openSync(filePath, ...args);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    assert.throws(() => publishBatch({ review: reviewed, approval, classificationManifest: data.classificationManifest, paths: data.paths, contentDirectories: data.contentDirectories, receiptPath: path.join(data.temporaryEvidence, "fixture-new-pack.json"), fileSystem: injected }), /rolled back/);
    assert.equal(failed, true);
    assert.equal(fs.existsSync(path.join(data.generalDirectory, "fixture-new-pack.json")), false);
    assert.deepEqual(fs.readFileSync(data.ledgerPath), beforeLedger);
    assert.equal(fs.existsSync(path.join(data.transactions, "transaction.json")), false);
});

test("a durable committed publication is reported as committed if initial journal cleanup fails", (t) => {
    const data = setup(t);
    const reviewed = data.review();
    const approval = data.approvalFor(reviewed);
    let failed = false;
    const injected = new Proxy(fs, { get(target, property) {
        if (property === "unlinkSync") return (filePath) => {
            if (!failed && String(filePath).endsWith(".ledger.bak")) { failed = true; throw new Error("simulated cleanup interruption"); }
            return target.unlinkSync(filePath);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = publishBatch({ review: reviewed, approval, classificationManifest: data.classificationManifest, paths: data.paths, contentDirectories: data.contentDirectories, receiptPath: path.join(data.temporaryEvidence, "fixture-new-pack.json"), fileSystem: injected });
    assert.equal(failed, true);
    assert.deepEqual(result.pack.questions.map(({ id }) => id), ["new-one"]);
    assert.equal(fs.existsSync(path.join(data.generalDirectory, "fixture-new-pack.json")), true);
    assert.equal(fs.existsSync(path.join(data.transactions, "transaction.json")), false);
});

test("a batch with already-published and new questions requires a disposition for each", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [structuredClone(data.questions[0]), question("new-two")] });
    data.classificationManifest.classifications.push({ ...data.classificationManifest.classifications[0], questionId: "new-two", underlyingClaimSummary: "Second new claim." });
    fs.writeFileSync(data.classificationPath, `${JSON.stringify(data.classificationManifest, null, 2)}\n`);
    const reviewed = data.review();
    assert.equal(reviewed.report.newQuestionIds.length, 1);
    assert.equal(reviewed.report.sameIdIdentical.length, 1);
    const approval = data.approvalFor(reviewed, { "old-one": "already-published", "new-two": "publish" });
    const result = data.publish(reviewed, approval);
    assert.deepEqual(result.pack.questions.map(({ id }) => id), ["new-two"]);
});

test("cleanup is blocked when the ledger changes after publication", (t) => {
    const data = setup(t);
    const result = data.publish(data.review());
    const ledger = JSON.parse(fs.readFileSync(data.ledgerPath, "utf8"));
    ledger.questionRecords.pop();
    fs.writeFileSync(data.ledgerPath, JSON.stringify(ledger));
    const status = cleanupEligibility({ inputPath: data.inputPath, reportPath: result.receiptPath, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.equal(status.eligible, false);
    assert.ok(status.errors.some((item) => item.includes("ledger has changed")));
    assert.equal(fs.existsSync(data.inputPath), true);
});

test("cleanup eligibility succeeds only after publication and explicit deletion confirms pack identity", (t) => {
    const data = setup(t);
    const result = data.publish(data.review());
    const eligibility = cleanupEligibility({ inputPath: data.inputPath, reportPath: result.receiptPath, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.equal(eligibility.eligible, true, eligibility.errors.join("\n"));
    assert.throws(() => cleanupCandidate({ inputPath: data.inputPath, reportPath: result.receiptPath, paths: data.paths, contentDirectories: data.contentDirectories }), /requires --confirm-delete/);
    const deleted = cleanupCandidate({ inputPath: data.inputPath, reportPath: result.receiptPath, confirmPackId: data.contentPackId, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.equal(deleted.contentPackId, data.contentPackId);
    assert.equal(fs.existsSync(data.inputPath), false);
    assert.equal(deleted.deletedReceipt, true);
    assert.equal(fs.existsSync(result.receiptPath), false);
    assert.equal(fs.existsSync(data.temporaryEvidence), false);
});

test("cleanup is blocked when a candidate includes an explicitly excluded question", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [question("new-one"), question("new-two", "A different fixture prompt ____?", "two")] });
    data.classificationManifest.classifications.push({ ...data.classificationManifest.classifications[0], questionId: "new-two", underlyingClaimSummary: "A second reviewed fixture claim." });
    fs.writeFileSync(data.classificationPath, `${JSON.stringify(data.classificationManifest, null, 2)}\n`);
    const reviewed = data.review();
    const approval = data.approvalFor(reviewed, { "new-one": "publish", "new-two": "exclude" });
    approval.decisions.find(({ questionId }) => questionId === "new-two").rationale = "Keep this candidate material for a later reviewed split.";
    const result = data.publish(reviewed, approval);
    const status = cleanupEligibility({ inputPath: data.inputPath, reportPath: result.receiptPath, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.equal(status.eligible, false);
    assert.ok(status.errors.some((item) => item.includes("was excluded and remains unpublished")));
});

test("cleanup refuses candidates outside incoming and mismatched candidate bytes", (t) => {
    const data = setup(t);
    const result = data.publish(data.review());
    fs.appendFileSync(data.inputPath, " ");
    const status = cleanupEligibility({ inputPath: data.inputPath, reportPath: result.receiptPath, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.ok(status.errors.some((item) => item.includes("no longer match")));
    const outside = path.join(data.root, "elsewhere.json");
    fs.copyFileSync(data.inputPath, outside);
    const outsideStatus = cleanupEligibility({ inputPath: outside, reportPath: result.receiptPath, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.ok(outsideStatus.errors.some((item) => item.includes("limited to files inside")));
});

function makePublishedAnimeManifest(data, { manifestOverrides = {} } = {}) {
    const contentPackId = "anime-bizarre-batch-009";
    const franchiseId = "fixture-anime-series";
    const pack = { contentPackId, questions: [question("anime-b009-fixture-one")] };
    const manifest = {
        manifestVersion: 1,
        franchises: [{ franchiseId, displayName: "Fixture Anime Series", aliases: ["Fixture Series"] }],
        entries: [{ questionId: pack.questions[0].id, franchiseId }],
        ...manifestOverrides
    };
    const ledger = JSON.parse(fs.readFileSync(data.animeLedgerPath, "utf8"));
    const update = makeAnimeLedgerUpdate(ledger, manifest, pack, []);
    assert.equal(update.valid, true, update.errors.join("\n"));
    fs.writeFileSync(path.join(data.animeDirectory, `${contentPackId}.json`), `${JSON.stringify(pack, null, 2)}\n`);
    fs.writeFileSync(data.animeLedgerPath, `${JSON.stringify(update.updatedLedger, null, 2)}\n`);
    const manifestPath = path.join(data.incoming, `${contentPackId}-franchises.json`);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { contentPackId, manifestPath, manifest };
}

test("franchise manifest cleanup requires exact published pack and reconciled ledger matches", (t) => {
    const data = setup(t);
    const { contentPackId, manifestPath } = makePublishedAnimeManifest(data);
    const eligibility = cleanupFranchiseManifestEligibility({ manifestPath, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.equal(eligibility.eligible, true, eligibility.errors.join("\n"));
    assert.throws(() => cleanupFranchiseManifest({ manifestPath, paths: data.paths, contentDirectories: data.contentDirectories }), /requires --confirm-delete/);
    const result = cleanupFranchiseManifest({ manifestPath, confirmPackId: contentPackId, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.equal(result.contentPackId, contentPackId);
    assert.equal(fs.existsSync(manifestPath), false);
    assert.equal(fs.existsSync(path.join(data.animeDirectory, `${contentPackId}.json`)), true);
    assert.equal(fs.existsSync(data.animeLedgerPath), true);
});

test("franchise manifest cleanup preserves files when assignments do not match the ledger", (t) => {
    const data = setup(t);
    const { contentPackId, manifestPath, manifest } = makePublishedAnimeManifest(data);
    manifest.entries[0].franchiseId = "wrong-franchise";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const eligibility = cleanupFranchiseManifestEligibility({ manifestPath, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.errors.some((item) => item.includes("does not match the reconciled ledger")));
    assert.throws(() => cleanupFranchiseManifest({ manifestPath, confirmPackId: contentPackId, paths: data.paths, contentDirectories: data.contentDirectories }), /not eligible for cleanup/);
    assert.equal(fs.existsSync(manifestPath), true);
});

test("franchise manifest cleanup is blocked until its matching candidate has been guardedly removed", (t) => {
    const data = setup(t);
    const { manifestPath, contentPackId } = makePublishedAnimeManifest(data);
    const candidatePath = path.join(data.incoming, `${contentPackId}-candidate.json`);
    fs.writeFileSync(candidatePath, "{}");
    const eligibility = cleanupFranchiseManifestEligibility({ manifestPath, paths: data.paths, contentDirectories: data.contentDirectories });
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.errors.some((item) => item.includes("candidate file must be removed by guarded publication cleanup")));
    assert.equal(fs.existsSync(manifestPath), true);
});

test("report records every question disposition and source location for duplicate warnings", (t) => {
    const data = setup(t);
    replaceCandidate(data, { ...data.candidate, questions: [question("new-id", data.questions[0].text, data.questions[0].correctCompletion)] });
    const report = data.review().report;
    assert.equal(report.candidateQuestionCount, 1);
    assert.equal(report.exactDuplicates[0].existingQuestionId, "old-one");
    assert.equal(report.exactDuplicates[0].existingPackFile, "fixture-general.json");
    assert.equal(report.withinBatchDuplicates.length, 0);
    assert.ok(report.ledger.missingMetadataQuestionIds.includes("new-id"));
});

test("Anime ledger additions preserve franchise identity and update exact membership", (t) => {
    const old = question("anime-old");
    const pack = { fileName: "anime-existing.json", contentPackId: "anime-existing", questions: [old] };
    const ledger = { ledgerVersion: 1, bankSnapshot: { questionCount: 1, contentPackCount: 1 }, franchises: [{ franchiseId: "series-a", displayName: "Series A", questionCount: 1, packMemberships: [{ contentPackId: "anime-existing", questionIds: ["anime-old"] }], aliases: ["Series A short"] }] };
    const candidate = { contentPackId: "anime-new", questions: [question("anime-new-q")] };
    const manifest = { manifestVersion: 1, franchises: [{ franchiseId: "series-b", displayName: "Series B", aliases: ["B"] }], entries: [{ questionId: "anime-new-q", franchiseId: "series-b" }] };
    const result = makeAnimeLedgerUpdate(ledger, manifest, candidate, [pack]);
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.updatedLedger.bankSnapshot.questionCount, 2);
    assert.deepEqual(result.updatedLedger.franchises[1].packMemberships[0].questionIds, ["anime-new-q"]);
    assert.deepEqual(result.updatedLedger.franchises[0].aliases, ["Series A short"]);
});

test("Anime ledger rejects stale or duplicate membership and ambiguous aliases", (t) => {
    const old = question("anime-old");
    const pack = { fileName: "anime-existing.json", contentPackId: "anime-existing", questions: [old] };
    const bad = { ledgerVersion: 1, bankSnapshot: { questionCount: 1, contentPackCount: 1 }, franchises: [
        { franchiseId: "series-a", displayName: "Series A", questionCount: 1, packMemberships: [{ contentPackId: "anime-existing", questionIds: ["anime-old", "missing"] }], aliases: ["shared"] },
        { franchiseId: "series-b", displayName: "Series B", questionCount: 0, packMemberships: [], aliases: ["shared"] }
    ] };
    const result = makeAnimeLedgerUpdate(bad, { manifestVersion: 1, franchises: [], entries: [] }, { contentPackId: "unused", questions: [] }, [pack]);
    assert.ok(result.errors.some((item) => item.includes("unpublished question")));
    assert.ok(result.errors.some((item) => item.includes("ambiguous")));
});

test("published Anime ledger reconciles merged franchise identity and pack filenames", () => {
    const contentDirectory = path.join(__dirname, "..", "games", "fact-or-cap", "content", "anime");
    const researchDirectory = path.join(__dirname, "..", "games", "fact-or-cap", "research");
    const ledger = JSON.parse(fs.readFileSync(path.join(researchDirectory, "anime-franchise-ledger.json"), "utf8"));
    const existingPacks = fs.readdirSync(contentDirectory).filter((name) => name.endsWith(".json")).sort().map((fileName) => {
        const pack = JSON.parse(fs.readFileSync(path.join(contentDirectory, fileName), "utf8"));
        return { fileName, contentPackId: pack.contentPackId, questions: pack.questions };
    });
    const result = makeAnimeLedgerUpdate(
        ledger,
        { manifestVersion: 1, franchises: [], entries: [] },
        { contentPackId: "anime-bizarre-batch-005", questions: [] },
        existingPacks
    );

    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.errors.length, 0);
    assert.equal(ledger.bankSnapshot.questionCount, 637);
    assert.equal(ledger.bankSnapshot.contentPackCount, 11);
    const promisedNeverland = result.updatedLedger.franchises.filter(({ franchiseId }) => franchiseId === "promised-neverland");
    assert.equal(promisedNeverland.length, 1);
    assert.equal(promisedNeverland[0].questionCount, 2);
    assert.deepEqual(promisedNeverland[0].packMemberships, [
        { contentPackId: "anime-bizarre-batch-005", questionIds: ["anime-b005-promised-neverland-demons"] },
        { contentPackId: "anime-facts-batch-2026-10", questionIds: ["promised-neverland-learning-ability"] }
    ]);
    assert.ok(existingPacks.every(({ fileName, contentPackId }) => path.basename(fileName, ".json") === contentPackId));
});

test("recovery command is harmless with no journal and report hashes use stable SHA-256", (t) => {
    const data = setup(t);
    assert.equal(recoverPublication({ paths: data.paths, contentDirectories: data.contentDirectories }).recovered, false);
    assert.equal(sha256(Buffer.from("fixture")), "f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d");
});
