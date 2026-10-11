const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { generateReviewPacket, loadLegacyLibraries } = require("../games/fake-answer/reviewPacket");
const { validateSourceReviewFindings } = require("../games/fake-answer/sourceReviewFindings");

const planPath = path.join(__dirname, "..", "games", "fake-answer", "content-canonical", "review-shadow-batch.json");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const sourceReviewFindingsPath = path.join(__dirname, "..", "games", "fake-answer", "content-canonical", "source-review-findings-task-10.json");
const sourceReviewFindings = JSON.parse(fs.readFileSync(sourceReviewFindingsPath, "utf8"));
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
    assert.equal(saturn.sourceReviewObservations.status, "not-provided");
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

test("valid Task 10 observations attach only to exact legacy identities", () => {
    const packet = generateReviewPacket(plan, { libraries, sourceReviewFindings });
    assert.equal(packet.inputs.sourceReviewFindings, "valid");
    assert.equal(packet.sourceReviewFindings.effectOnFormalDecisions, "none");
    assert.equal(packet.sourceReviewFindings.effectOnReadiness, "none");
    for (const questionId of ["saturn-ring-material", "octopus-hearts", "spy-family-anya-ability"]) {
        const item = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === questionId);
        assert.equal(item.sourceReviewObservations.status, "present");
        assert.ok(item.sourceReviewObservations.observations.length > 0);
        assert.equal(item.reviewDecisions.status, "missing");
        assert.equal(item.readiness.status, "not-assessed");
    }
    const outOfScope = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === "ocean-average-salinity");
    assert.equal(outOfScope.sourceReviewObservations.status, "not-in-scope");
});

test("missing findings and unknown candidate identities are reported without guessing", () => {
    const incomplete = structuredClone(sourceReviewFindings);
    incomplete.items = incomplete.items.filter(({ candidate }) => candidate.questionId !== "octopus-hearts");
    incomplete.items.push({
        candidate: { gameId: "fact-or-cap", contentPackId: "other-pack", questionId: "octopus-hearts" },
        observations: [sourceReviewFindings.items[1].observations[0]]
    });
    const validation = validateSourceReviewFindings(incomplete, plan);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((message) => message.includes("Missing source-review findings") && message.includes("octopus-hearts")));
    assert.equal(validation.unmatchedItems[0].status, "unknown-candidate");
    const packet = generateReviewPacket(plan, { libraries, sourceReviewFindings: incomplete });
    const octopus = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === "octopus-hearts");
    assert.equal(octopus.sourceReviewObservations.status, "missing");
    assert.ok(packet.sourceReviewFindings.unmatchedItems.some(({ status }) => status === "unknown-candidate"));
});

test("duplicate exact source-review identities are ambiguous rather than selected", () => {
    const ambiguous = structuredClone(sourceReviewFindings);
    ambiguous.items.push(structuredClone(ambiguous.items[0]));
    const packet = generateReviewPacket(plan, { libraries, sourceReviewFindings: ambiguous });
    const saturn = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === "saturn-ring-material");
    assert.equal(saturn.sourceReviewObservations.status, "ambiguous");
    assert.deepEqual(saturn.sourceReviewObservations.observations, []);
    assert.match(packet.sourceReviewFindings.errors.join("\n"), /Ambiguous source-review identity/);

    const duplicatePlan = { ...plan, items: [...plan.items, plan.items[0]] };
    const duplicatePlanPacket = generateReviewPacket(duplicatePlan, { libraries, sourceReviewFindings });
    const duplicateSaturnItems = duplicatePlanPacket.items.filter(({ legacyIdentity }) => legacyIdentity.questionId === "saturn-ring-material");
    assert.equal(duplicateSaturnItems.length, 2);
    assert.ok(duplicateSaturnItems.every(({ sourceReviewObservations }) => sourceReviewObservations.status === "ambiguous"));
});

test("invalid evidence fields are reported and not attached as observations", () => {
    const malformed = structuredClone(sourceReviewFindings);
    malformed.items[0].observations[0].evidenceLocator = null;
    malformed.items[0].observations[0].sourceUrl = "javascript:alert(1)";
    const validation = validateSourceReviewFindings(malformed, plan);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((message) => message.includes("evidenceLocator is required")));
    assert.ok(validation.errors.some((message) => message.includes("sourceUrl must be an HTTP or HTTPS URL")));
    const packet = generateReviewPacket(plan, { libraries, sourceReviewFindings: malformed });
    const saturn = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === "saturn-ring-material");
    assert.equal(saturn.sourceReviewObservations.status, "invalid");
    assert.deepEqual(saturn.sourceReviewObservations.observations, []);

    const nullPacket = generateReviewPacket(plan, { libraries, sourceReviewFindings: null });
    assert.equal(nullPacket.inputs.sourceReviewFindings, "invalid");
    assert.equal(nullPacket.items.find(({ legacyIdentity }) => legacyIdentity.questionId === "saturn-ring-material").sourceReviewObservations.status, "invalid");

    const unsupported = structuredClone(sourceReviewFindings);
    unsupported.schemaVersion = 99;
    unsupported.inspectionDate = "2026-02-31";
    const versionValidation = validateSourceReviewFindings(unsupported, plan);
    assert.ok(versionValidation.errors.some((message) => message.includes("schemaVersion must be 1")));
    assert.ok(versionValidation.errors.some((message) => message.includes("inspectionDate must be an ISO calendar date")));
});

test("inaccessible sources retain explicit null locators and access limitations", () => {
    const validation = validateSourceReviewFindings(sourceReviewFindings, plan);
    assert.equal(validation.valid, true);
    const packet = generateReviewPacket(plan, { libraries, sourceReviewFindings });
    const octopus = packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === "octopus-hearts");
    assert.ok(octopus.sourceReviewObservations.observations.every((observation) =>
        observation.inspectionOutcome === "inaccessible" && observation.evidenceLocator === null
    ));
});

test("observations do not populate formal decisions or alter readiness", () => {
    const transformationId = "transform:shadow-saturn-observation-independence";
    const canonical = makeCanonical(saturnCandidate, transformationId);
    const reviewManifest = {
        schemaVersion: 1,
        items: [{
            transformationId,
            claimVerifications: [{ claimId: "claim:test-main", status: "verified", reviewerId: "reviewer-test", decidedAt: "2026-10-11", rationale: "Synthetic test decision.", evidenceLocator: "test:claim" }],
            sourceSupport: [{ claimId: "claim:test-main", sourceId: "source:test-attribution", status: "supports", reviewerId: "reviewer-test", decidedAt: "2026-10-11", rationale: "Synthetic test decision.", evidenceLocator: "test:source" }],
            rightsAssessments: [{ sourceId: "source:test-attribution", status: "permitted", reviewerId: "reviewer-test", decidedAt: "2026-10-11", rationale: "Synthetic test decision.", rightsBasis: "test-only" }],
            useApprovals: [{ intendedUse: useId, status: "approved", reviewerId: "reviewer-test", decidedAt: "2026-10-11", rationale: "Synthetic test decision.", conditions: [] }],
            disposition: { status: "active" }
        }]
    };
    const options = {
        libraries,
        canonicalContent: canonical,
        migrationManifest: migrationFor(saturnCandidate, transformationId),
        reviewManifest,
        intendedUse: useId
    };
    const withoutObservations = generateReviewPacket(plan, options);
    const withObservations = generateReviewPacket(plan, { ...options, sourceReviewFindings });
    const getSaturn = (packet) => packet.items.find(({ legacyIdentity }) => legacyIdentity.questionId === saturnCandidate.questionId);
    assert.deepEqual(getSaturn(withObservations).reviewDecisions, getSaturn(withoutObservations).reviewDecisions);
    assert.deepEqual(getSaturn(withObservations).readiness, getSaturn(withoutObservations).readiness);
    assert.deepEqual(getSaturn(withObservations).blockersByDimension, getSaturn(withoutObservations).blockersByDimension);
    assert.equal(getSaturn(withObservations).readiness.ready, true);
});

test("source-review packet output is deterministic", () => {
    const options = { libraries, sourceReviewFindings };
    assert.deepEqual(generateReviewPacket(plan, options), generateReviewPacket(plan, options));
});
