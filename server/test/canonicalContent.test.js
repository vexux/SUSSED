const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateCanonicalContent } = require("../games/fact-or-cap/canonicalContent");

const fixturePath = path.join(
    __dirname,
    "..",
    "games",
    "fact-or-cap",
    "content-canonical",
    "pilot.json"
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function cloneFixture() {
    return structuredClone(fixture);
}

test("canonical pilot fixture validates and supports two transformations of shared information", () => {
    const result = validateCanonicalContent(fixture, "pilot.json");
    assert.deepEqual(result, { valid: true, errors: [] });
    assert.equal(fixture.transformations.length, 2);
    assert.deepEqual(
        fixture.transformations.map(({ claimIds }) => claimIds),
        [["claim:sailor-moon-talking-cat"], ["claim:sailor-moon-talking-cat"]]
    );
    assert.deepEqual(
        fixture.transformations.map(({ entityIds }) => entityIds),
        [
            ["entity:sailor-moon", "entity:luna"],
            ["entity:sailor-moon", "entity:luna"]
        ]
    );
    assert.equal(fixture.sources[0].rightsReview.status, "unknown");
    assert.equal(fixture.sources[0].rightsReview.license, null);
});

test("canonical claims can reference multiple sources structurally", () => {
    const candidate = cloneFixture();
    candidate.sources.push({
        id: "source:secondary-reference",
        title: "Secondary source record for structural validation",
        url: "https://example.org/secondary-reference",
        publisher: "Example Publisher",
        creator: null,
        accessedAt: null,
        reviewStatus: "unreviewed",
        rightsReview: {
            status: "unknown",
            license: null,
            reviewedAt: null,
            reviewerId: null,
            notes: "Synthetic validation record; source support has not been assessed."
        }
    });
    candidate.claims[0].sourceIds.push("source:secondary-reference");

    assert.deepEqual(validateCanonicalContent(candidate), { valid: true, errors: [] });
    assert.equal(candidate.claims[0].sourceIds.length, 2);
});

test("canonical validation reports missing required fields", () => {
    const candidate = cloneFixture();
    delete candidate.entities[0].name;
    const result = validateCanonicalContent(candidate);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /entities\[0\]\.name is required/);

    const missingRightsNotes = cloneFixture();
    delete missingRightsNotes.sources[0].rightsReview.notes;
    assert.match(
        validateCanonicalContent(missingRightsNotes).errors.join("\n"),
        /sources\[0\]\.rightsReview\.notes is required/
    );
});

test("canonical validation rejects duplicate IDs across record collections", () => {
    const candidate = cloneFixture();
    candidate.sources[0].id = candidate.entities[0].id;
    const result = validateCanonicalContent(candidate);
    assert.match(result.errors.join("\n"), /sources\[0\]\.id duplicates entities\[0\]/);
});

test("canonical validation rejects unknown entity, source, and transformation references", () => {
    const candidate = cloneFixture();
    candidate.claims[0].entityIds[0] = "entity:missing";
    candidate.claims[0].sourceIds[0] = "source:missing";
    candidate.transformations[0].claimIds[0] = "claim:missing";
    const result = validateCanonicalContent(candidate);
    const errors = result.errors.join("\n");
    assert.match(errors, /references unknown ID entity:missing/);
    assert.match(errors, /references unknown ID source:missing/);
    assert.match(errors, /references unknown ID claim:missing/);
});

test("canonical validation rejects repeated references and entities detached from linked claims", () => {
    const candidate = cloneFixture();
    candidate.claims[0].entityIds.push("entity:luna");
    candidate.entities.push({
        id: "entity:unrelated",
        kind: "concept",
        name: "Unrelated concept",
        reviewStatus: "unreviewed"
    });
    candidate.transformations[0].entityIds = ["entity:unrelated"];
    const result = validateCanonicalContent(candidate);
    const errors = result.errors.join("\n");
    assert.match(errors, /claims\[0\]\.entityIds must not contain duplicate IDs/);
    assert.match(errors, /transformations\[0\]\.entityIds\[0\] must be referenced by at least one linked claim/);
});

test("canonical validation rejects self and circular franchise relationships", () => {
    const selfReference = cloneFixture();
    selfReference.entities[0].franchiseEntityId = "entity:sailor-moon";
    assert.match(
        validateCanonicalContent(selfReference).errors.join("\n"),
        /cannot reference the entity itself/
    );

    const cycle = cloneFixture();
    cycle.entities[0].franchiseEntityId = "entity:luna";
    assert.match(
        validateCanonicalContent(cycle).errors.join("\n"),
        /creates a circular franchise relationship/
    );
});

test("canonical validation rejects contradictory unknown rights metadata and invalid dates", () => {
    const candidate = cloneFixture();
    candidate.sources[0].rightsReview.license = "CC BY 4.0";
    candidate.sources[0].accessedAt = "2026-02-31";
    const result = validateCanonicalContent(candidate);
    const errors = result.errors.join("\n");
    assert.match(errors, /must be null when rights status is unknown/);
    assert.match(errors, /accessedAt must be an ISO calendar date or null/);
});

test("canonical validation rejects unsupported document versions and redundant record versions", () => {
    const candidate = cloneFixture();
    candidate.schemaVersion = 2;
    candidate.claims[0].recordVersion = 2;
    const result = validateCanonicalContent(candidate);
    assert.match(result.errors.join("\n"), /schemaVersion must be the supported version 1/);
    assert.match(result.errors.join("\n"), /claims\[0\]\.recordVersion is not used in schema version 1/);
});

test("canonical validation rejects unsupported review, verification, and rights statuses", () => {
    const candidate = cloneFixture();
    candidate.entities[0].reviewStatus = "approved";
    candidate.claims[0].verificationStatus = "probably-true";
    candidate.sources[0].rightsReview.status = "free";
    const result = validateCanonicalContent(candidate);
    const errors = result.errors.join("\n");
    assert.match(errors, /entities\[0\]\.reviewStatus has unsupported value/);
    assert.match(errors, /claims\[0\]\.verificationStatus has unsupported value/);
    assert.match(errors, /sources\[0\]\.rightsReview\.status has unsupported value/);
});

test("canonical validation requires dated reviewer evidence for permission status", () => {
    const candidate = cloneFixture();
    candidate.sources[0].rightsReview.status = "permitted";
    const result = validateCanonicalContent(candidate);
    const errors = result.errors.join("\n");
    assert.match(errors, /must record the applicable license or basis/);
    assert.match(errors, /permitted or public-domain status requires a review date and reviewer ID/);
});
