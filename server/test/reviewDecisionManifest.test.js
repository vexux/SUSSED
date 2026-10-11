const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { evaluateReadiness, validateDecisionManifest } = require("../games/fake-answer/reviewDecisionManifest");

const fixtureDir = path.join(__dirname, "fixtures", "canonical-review");
const canonicalFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "synthetic-content.json"), "utf8"));
const decisionsFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "fully-reviewed.json"), "utf8"));

function clone(value) {
    return structuredClone(value);
}

function report(manifest = decisionsFixture, canonical = canonicalFixture, options = {}) {
    return evaluateReadiness(manifest, canonical, { intendedUse: "test-only", ...options });
}

test("fully reviewed synthetic fixture is ready while dimensions remain separate", () => {
    const result = report();
    assert.equal(validateDecisionManifest(decisionsFixture, canonicalFixture).valid, true);
    assert.equal(result.ready, true);
    assert.equal(result.structuralValidity.status, "valid");
    assert.equal(result.items[0].adapterCompatibility.status, "compatible");
    assert.equal(result.items[0].legacyParity.status, "not-checked");
    assert.equal(result.items[0].claimVerification[0].status, "verified");
    assert.equal(result.items[0].sourceSupport[0].status, "supports");
    assert.equal(result.items[0].rightsAssessment[0].status, "permitted");
    assert.equal(result.items[0].useApproval.status, "approved");
});

test("missing review decisions are structurally valid but block readiness with actionable reasons", () => {
    const incomplete = clone(decisionsFixture);
    incomplete.items[0].claimVerifications = [];
    incomplete.items[0].sourceSupport = [];
    incomplete.items[0].rightsAssessments = [];
    incomplete.items[0].useApprovals = [];
    const result = report(incomplete);
    assert.equal(result.structuralValidity.status, "valid");
    assert.equal(result.ready, false);
    assert.match(result.items[0].reasons.join("\n"), /no verification decision/);
    assert.match(result.items[0].reasons.join("\n"), /no support decision/);
    assert.match(result.items[0].reasons.join("\n"), /no rights assessment/);
    assert.match(result.items[0].reasons.join("\n"), /No approval is recorded/);
});

test("unknown rights status blocks publication readiness", () => {
    const pendingRights = clone(decisionsFixture);
    Object.assign(pendingRights.items[0].rightsAssessments[0], {
        status: "unknown",
        rightsBasis: undefined,
        rationale: "Rights review is pending."
    });
    assert.equal(report(pendingRights).items[0].ready, false);
    assert.match(report(pendingRights).items[0].reasons.join("\n"), /Rights .*unknown/);
});

test("insufficient or conflicting source support blocks readiness", () => {
    const insufficient = clone(decisionsFixture);
    Object.assign(insufficient.items[0].sourceSupport[0], {
        status: "insufficient",
        rationale: "The cited material does not resolve the claim."
    });
    assert.match(report(insufficient).items[0].reasons.join("\n"), /marked insufficient/);

    const canonical = clone(canonicalFixture);
    const extraSource = clone(canonical.sources[0]);
    extraSource.id = "source:fixture-second-specimen";
    extraSource.title = "Second synthetic specimen";
    canonical.sources.push(extraSource);
    canonical.claims[0].sourceIds.push(extraSource.id);
    const conflicting = clone(decisionsFixture);
    conflicting.items[0].sourceSupport.push({
        claimId: "claim:fixture-card-text",
        sourceId: extraSource.id,
        status: "contradicts",
        reviewerId: "fixture-reviewer",
        decidedAt: "2026-10-11",
        rationale: "Synthetic fixture conflict only.",
        evidenceLocator: "fixture-only:second-specimen/line-1"
    });
    conflicting.items[0].rightsAssessments.push({
        sourceId: extraSource.id,
        status: "permitted",
        reviewerId: "fixture-reviewer",
        decidedAt: "2026-10-11",
        rationale: "Synthetic fixture decision only.",
        rightsBasis: "fixture-only:synthetic"
    });
    const result = report(conflicting, canonical);
    assert.equal(result.ready, false);
    assert.match(result.items[0].reasons.join("\n"), /marked contradicts/);
});

test("disputed claims prevent readiness", () => {
    const disputed = clone(decisionsFixture);
    Object.assign(disputed.items[0].claimVerifications[0], {
        status: "disputed",
        rationale: "Synthetic fixture dispute.",
        evidenceLocator: "fixture-only:dispute"
    });
    assert.match(report(disputed).items[0].reasons.join("\n"), /is disputed/);
});

test("rejected and withdrawn transformations prevent readiness and require reason and timestamp", () => {
    for (const status of ["rejected", "withdrawn"]) {
        const item = clone(decisionsFixture);
        item.items[0].disposition = {
            status,
            reason: "Synthetic fixture disposition.",
            reviewerId: "fixture-reviewer",
            decidedAt: "2026-10-11"
        };
        assert.match(report(item).items[0].reasons.join("\n"), new RegExp(`Transformation is ${status}`));
        delete item.items[0].disposition.decidedAt;
        assert.equal(validateDecisionManifest(item, canonicalFixture).valid, false);
    }
});

test("canonical records already marked rejected cannot be approved by the sidecar", () => {
    const canonical = clone(canonicalFixture);
    canonical.transformations[0].reviewStatus = "rejected";
    const result = report(decisionsFixture, canonical);
    assert.equal(result.items[0].ready, false);
    assert.match(result.items[0].reasons.join("\n"), /Canonical records marked rejected/);
});

test("approval must match the requested intended use", () => {
    const result = evaluateReadiness(decisionsFixture, canonicalFixture, { intendedUse: "different-use" });
    assert.equal(result.items[0].useApproval.status, "missing");
    assert.match(result.items[0].reasons.join("\n"), /No approval is recorded for intended use "different-use"/);
});

test("unknown references and unsupported decision values are structural errors", () => {
    const invalid = clone(decisionsFixture);
    invalid.items[0].sourceSupport[0].sourceId = "source:missing";
    invalid.items[0].useApprovals[0].status = "probably-approved";
    const result = validateDecisionManifest(invalid, canonicalFixture);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /references a claim\/source relationship not used/);
    assert.match(result.errors.join("\n"), /unsupported value/);

    const malformed = evaluateReadiness({ schemaVersion: 1, items: [null] }, canonicalFixture, { intendedUse: "test-only" });
    assert.equal(malformed.structuralValidity.status, "invalid");
    assert.equal(malformed.items[0].ready, false);
});

test("readiness report output is deterministic", () => {
    assert.deepEqual(report(), report());
});
