const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { generateReviewPacket, loadLegacyLibraries } = require("../games/fake-answer/reviewPacket");

const planPath = path.join(__dirname, "..", "games", "fake-answer", "content-canonical", "review-shadow-batch.json");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const libraries = loadLegacyLibraries().libraries;
const saturnCandidate = plan.items[0];
const octopusCandidate = plan.items.find(({ questionId }) => questionId === "octopus-hearts");
const useId = "shadow-review-test";

function findQuestion(candidate) {
    const pack = libraries.get(candidate.gameId).find(({ contentPackId }) => contentPackId === candidate.contentPackId);
    return pack.questions.find(({ id }) => id === candidate.questionId);
}

function makeCanonical(candidate, transformationId, { multiClaim = false } = {}) {
    const question = findQuestion(candidate);
    const subjectId = "entity:test-subject";
    const answerId = "entity:test-answer";
    const sourceId = "source:test-attribution";
    const claimIds = multiClaim ? ["claim:test-part-one", "claim:test-part-two"] : ["claim:test-main"];
    const claimText = question.text.replace(/_{2,}|\.\.\.$/u, question.correctCompletion);
    return {
        schemaVersion: 1,
        entities: [
            { id: subjectId, kind: "concept", name: "Test subject", reviewStatus: "unreviewed" },
            { id: answerId, kind: "concept", name: "Test answer", reviewStatus: "unreviewed" }
        ],
        claims: claimIds.map((id, index) => ({
            id,
            statement: multiClaim ? `Synthetic component claim ${index + 1}.` : claimText,
            entityIds: [subjectId, answerId],
            sourceIds: [sourceId],
            verificationStatus: "unverified",
            reviewStatus: "unreviewed"
        })),
        sources: [{
            id: sourceId,
            title: question.sourceName,
            url: question.sourceUrl,
            publisher: null,
            creator: null,
            accessedAt: null,
            reviewStatus: "unreviewed",
            rightsReview: { status: "unknown", license: null, reviewedAt: null, reviewerId: null, notes: "Copied attribution only; no source review performed." }
        }],
        transformations: [{
            id: transformationId,
            gameFormatId: "fact-or-cap.completion.v1",
            entityIds: [subjectId, answerId],
            claimIds,
            reviewStatus: "unreviewed",
            payload: {
                text: question.text,
                correctCompletion: question.correctCompletion,
                sourceId,
                category: question.category,
                tags: question.tags,
                difficulty: question.difficulty
            }
        }]
    };
}

function migrationFor(candidate, transformationId) {
    const { gameId, contentPackId, questionId } = candidate;
    return { schemaVersion: 1, entries: [{ gameId, contentPackId, questionId, transformationId }] };
}

test("default packet keeps all ten candidates and exposes legacy-only data with explicit missing steps", () => {
    const packet = generateReviewPacket(plan, { libraries });
    assert.equal(packet.summary.candidateCount, 10);
    assert.equal(packet.summary.legacyResolved, 10);
    assert.equal(packet.summary.explicitlyMapped, 0);
    assert.equal(packet.summary.readyForIntendedUse, 0);
    const saturn = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === "saturn-ring-material");
    assert.equal(saturn.legacyQuestion.completion, "ice");
    assert.equal(saturn.repositorySourceMetadata.sourceName, "NASA — Saturn Facts");
    assert.equal(saturn.canonical.sources.length, 0);
    assert.equal(saturn.reviewDecisions.status, "missing");
    assert.equal(saturn.mapping.status, "unmapped");
    assert.ok(saturn.blockersByDimension.mapping.length > 0);
    assert.ok(saturn.blockersByDimension.sourceSupport.some((message) => message.includes("No review-decision manifest")));
});

test("explicit canonical mapping resolves stable IDs and reports adapter and exact legacy parity separately", () => {
    const transformationId = "transform:shadow-saturn-rings";
    const canonical = makeCanonical(saturnCandidate, transformationId);
    const packet = generateReviewPacket(plan, {
        libraries,
        canonicalContent: canonical,
        migrationManifest: migrationFor(saturnCandidate, transformationId)
    });
    const saturn = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === saturnCandidate.questionId);
    assert.equal(saturn.mapping.status, "mapped");
    assert.equal(saturn.canonical.transformation.id, transformationId);
    assert.equal(saturn.canonical.claims.length, 1);
    assert.equal(saturn.canonical.sources[0].title, "NASA — Saturn Facts");
    assert.equal(saturn.canonical.sources[0].canonicalRightsStatus, "unknown");
    assert.equal(saturn.adapterCompatibility.status, "compatible");
    assert.equal(saturn.legacyParity.status, "match");
    assert.equal(saturn.readiness.status, "not-assessed");
    assert.equal(saturn.blockersByDimension.claimVerification.length > 0, true);
    assert.equal(saturn.blockersByDimension.rightsAssessment.length > 0, true);
});

test("review decisions and missing evidence are displayed without being inferred", () => {
    const transformationId = "transform:shadow-saturn-review";
    const canonical = makeCanonical(saturnCandidate, transformationId);
    const reviewManifest = {
        schemaVersion: 1,
        items: [{
            transformationId,
            claimVerifications: [],
            sourceSupport: [{ claimId: "claim:test-main", sourceId: "source:test-attribution", status: "unchecked", reviewerId: "editor-1", decidedAt: "2026-10-11", rationale: "Not inspected." }],
            rightsAssessments: [{ sourceId: "source:test-attribution", status: "unknown", reviewerId: "editor-1", decidedAt: "2026-10-11", rationale: "Not assessed." }],
            useApprovals: []
        }]
    };
    const packet = generateReviewPacket(plan, { libraries, canonicalContent: canonical, migrationManifest: migrationFor(saturnCandidate, transformationId), reviewManifest, intendedUse: useId });
    const item = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === saturnCandidate.questionId);
    assert.equal(item.reviewDecisions.status, "present");
    assert.equal(item.reviewDecisions.records[0].sourceSupport[0].status, "unchecked");
    assert.equal(item.reviewDecisions.records[0].sourceSupport[0].evidenceLocator, undefined);
    assert.match(item.blockersByDimension.sourceSupport.join("\n"), /unchecked/);
    assert.match(item.blockersByDimension.rightsAssessment.join("\n"), /unknown/);
    assert.match(item.blockersByDimension.useApproval.join("\n"), /missing/);
});

test("duplicate legacy mappings are reported as ambiguous instead of selecting one", () => {
    const firstId = "transform:shadow-saturn-one";
    const secondId = "transform:shadow-saturn-two";
    const canonical = makeCanonical(saturnCandidate, firstId);
    canonical.transformations.push({ ...canonical.transformations[0], id: secondId });
    const migrationManifest = { schemaVersion: 1, entries: [
        ...migrationFor(saturnCandidate, firstId).entries,
        ...migrationFor(saturnCandidate, secondId).entries
    ] };
    const packet = generateReviewPacket(plan, { libraries, canonicalContent: canonical, migrationManifest });
    const saturn = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === saturnCandidate.questionId);
    assert.equal(saturn.mapping.status, "ambiguous");
    assert.equal(saturn.mapping.transformationId, null);
    assert.match(saturn.blockersByDimension.mapping.join("\n"), /2 migration entries/);
});

test("multi-claim transformations are reported as Fact-or-Cap adapter incompatibilities", () => {
    const transformationId = "transform:shadow-octopus-compound";
    const canonical = makeCanonical(octopusCandidate, transformationId, { multiClaim: true });
    const packet = generateReviewPacket(plan, {
        libraries,
        canonicalContent: canonical,
        migrationManifest: migrationFor(octopusCandidate, transformationId)
    });
    const octopus = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === octopusCandidate.questionId);
    assert.equal(octopus.mapping.status, "mapped");
    assert.equal(octopus.canonical.claims.length, 2);
    assert.equal(octopus.adapterCompatibility.status, "incompatible");
    assert.match(octopus.blockersByDimension.adapterCompatibility.join("\n"), /exactly one linked claim/);
});

test("packet output is deterministic for the same inputs", () => {
    const transformationId = "transform:shadow-saturn-deterministic";
    const options = {
        libraries,
        canonicalContent: makeCanonical(saturnCandidate, transformationId),
        migrationManifest: migrationFor(saturnCandidate, transformationId)
    };
    assert.deepEqual(generateReviewPacket(plan, options), generateReviewPacket(plan, options));
});
