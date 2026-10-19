const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
    compareGeneralTopicLedger,
    formatGeneralTopicLedgerReport
} = require("../games/fact-or-cap/generalTopicLedgerReport");

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-general-ledger-"));
    const contentDirectory = path.join(root, "content");
    fs.mkdirSync(contentDirectory);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const questions = [
        { id: "q-one", text: "A question ____.", correctCompletion: "one", category: "science", tags: ["sample"], difficulty: "easy", sourceName: "Source", sourceUrl: "https://example.test/one" },
        { id: "q-two", text: "Another question ____.", correctCompletion: "two", category: "history", tags: [], sourceName: "Source", sourceUrl: "https://example.test/two" }
    ];
    fs.writeFileSync(path.join(contentDirectory, "fixture-pack.json"), JSON.stringify({ contentPackId: "fixture-pack", questions }));
    const record = (questionId, topicId = "science", subtopicId = "biology", type = "identification") => ({
        legacyIdentity: { gameId: "fact-or-cap", contentPackId: "fixture-pack", questionId },
        editorialClassification: { topicId, subtopicId, questionType: type, underlyingClaimSummary: `Claim about ${questionId}`, status: "provisional-editorial-classification", uncertaintyNote: null },
        legacyMetadata: questionId === "q-one" ? { category: "science", tags: ["sample"], difficulty: "easy" } : { category: "history", tags: [], difficulty: null },
        sourceReview: { attributionMetadataPresent: true, sourceName: "Source", sourceUrl: `https://example.test/${questionId === "q-one" ? "one" : "two"}`, claimVerification: "not-assessed-by-this-ledger", claimSourceSupport: "not-assessed-by-this-ledger", rightsOrReuse: "unknown" }
    });
    const ledger = {
        ledgerVersion: 1,
        baselineSnapshot: {
            publishedQuestionCount: 2,
            publishedContentPackCount: 1,
            attributionMetadataPresentCount: 2,
            contentPacks: [{ fileName: "fixture-pack.json", contentPackId: "fixture-pack", questionCount: 2 }]
        },
        taxonomy: [
            { topicId: "science", label: "Science", subtopics: ["biology", "physics"] },
            { topicId: "history", label: "History", subtopics: ["ancient"] },
            { topicId: "arts", label: "Arts", subtopics: ["music"] }
        ],
        classificationConventions: { questionTypes: ["identification", "chronology"] },
        questionRecords: [record("q-one"), record("q-two", "history", "ancient", "chronology")],
        repetitionReviewClusters: [{ clusterId: "possible-repeat", questionIds: ["q-one", "q-two"], note: "Check whether these are related.", status: "human-review-signal" }],
        suspectedSemanticDuplicates: [{ questionIds: ["q-one", "q-two"], note: "Not confirmed.", status: "needs-human-confirmation" }]
    };
    return { root, contentDirectory, questions, ledger, record };
}

test("valid ledger reconciles exact published identities and reports deterministic coverage", (t) => {
    const data = fixture(t);
    const packPath = path.join(data.contentDirectory, "fixture-pack.json");
    const before = fs.readFileSync(packPath, "utf8");
    const options = { ledger: data.ledger, contentDirectory: data.contentDirectory, lowTopicThreshold: 1 };
    const first = compareGeneralTopicLedger(options);
    const second = compareGeneralTopicLedger(options);
    assert.deepEqual(first, second);
    assert.equal(first.reconciliation.valid, true);
    assert.equal(first.reconciliation.publishedQuestionCount, 2);
    assert.equal(first.reconciliation.publishedPackCount, 1);
    assert.deepEqual(first.coverage.topicCounts.map((topic) => [topic.topicId, topic.count]), [["science", 1], ["history", 1], ["arts", 0]]);
    assert.equal(first.coverage.topicCounts.find((topic) => topic.topicId === "arts").lowCoverage, true);
    assert.equal(first.coverage.topicCounts.find((topic) => topic.topicId === "science").subtopics.find((subtopic) => subtopic.subtopicId === "physics").count, 0);
    assert.deepEqual(first.coverage.questionTypeCounts, { chronology: 1, identification: 1 });
    const text = formatGeneralTopicLedgerReport(first);
    assert.match(text, /possible-repeat: q-one, q-two/);
    assert.match(text, /Possible overlap: q-one \/ q-two/);
    assert.match(text, /does not inspect source pages or assess factual accuracy/);
    assert.doesNotMatch(text, /confirmed duplicate: q-one/);
    assert.equal(fs.readFileSync(packPath, "utf8"), before);
});

test("published questions missing from ledger are structural reconciliation errors", (t) => {
    const data = fixture(t);
    data.ledger.questionRecords.pop();
    const report = compareGeneralTopicLedger({ ledger: data.ledger, contentDirectory: data.contentDirectory });
    assert.equal(report.reconciliation.valid, false);
    assert.ok(report.reconciliation.errors.some((error) => error.includes("Published question is missing from ledger: fact-or-cap/fixture-pack/q-two")));
});

test("stale ledger identities and duplicate ledger identities are reported", (t) => {
    const data = fixture(t);
    data.ledger.questionRecords[1].legacyIdentity.questionId = "removed-question";
    data.ledger.questionRecords.push(data.record("q-one"));
    const report = compareGeneralTopicLedger({ ledger: data.ledger, contentDirectory: data.contentDirectory });
    assert.ok(report.reconciliation.errors.some((error) => error.includes("no longer exists in published packs: fact-or-cap/fixture-pack/removed-question")));
    assert.ok(report.reconciliation.errors.some((error) => error.includes("Duplicate ledger identity: fact-or-cap/fixture-pack/q-one")));
    assert.ok(report.reconciliation.errors.some((error) => error.includes("Published question is missing from ledger: fact-or-cap/fixture-pack/q-two")));
});

test("incorrect pack membership and synchronized copied-field drift are errors", (t) => {
    const data = fixture(t);
    data.ledger.questionRecords[0].legacyIdentity.contentPackId = "wrong-pack";
    data.ledger.questionRecords[1].sourceReview.sourceUrl = "https://example.test/stale";
    data.ledger.baselineSnapshot.contentPacks[0].questionCount = 1;
    const report = compareGeneralTopicLedger({ ledger: data.ledger, contentDirectory: data.contentDirectory });
    assert.ok(report.reconciliation.errors.some((error) => error.includes("Incorrect pack membership for fact-or-cap/wrong-pack/q-one")));
    assert.ok(report.reconciliation.errors.some((error) => error.includes("copied sourceUrl is stale")));
    assert.ok(report.reconciliation.errors.some((error) => error.includes("baseline snapshot has stale question count")));
});

test("unresolved topic, subtopic, question type, and repetition references are errors", (t) => {
    const data = fixture(t);
    data.ledger.questionRecords[0].editorialClassification.topicId = "unknown";
    data.ledger.questionRecords[1].editorialClassification.subtopicId = "unknown";
    data.ledger.questionRecords[1].editorialClassification.questionType = "unknown";
    data.ledger.repetitionReviewClusters[0].questionIds.push("missing-question");
    const report = compareGeneralTopicLedger({ ledger: data.ledger, contentDirectory: data.contentDirectory });
    assert.ok(report.reconciliation.errors.some((error) => error.includes("unresolved topicId")));
    assert.ok(report.reconciliation.errors.some((error) => error.includes("unresolved subtopicId")));
    assert.ok(report.reconciliation.errors.some((error) => error.includes("unresolved questionType")));
    assert.ok(report.reconciliation.errors.some((error) => error.includes("missing-question\" resolves to 0")));
});

test("repetition uncertainty stays editorial and a caller can configure low coverage", (t) => {
    const data = fixture(t);
    const report = compareGeneralTopicLedger({ ledger: data.ledger, contentDirectory: data.contentDirectory, lowTopicThreshold: 2 });
    assert.equal(report.reconciliation.valid, true);
    assert.equal(report.coverage.lowTopicThreshold, 2);
    assert.match(formatGeneralTopicLedgerReport(report), /Editorial repetition notes \(human review signals, not confirmed duplicates\)/);
    assert.equal(report.reconciliation.errors.some((error) => error.includes("duplicate")), false);
});
