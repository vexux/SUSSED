const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateCanonicalContent } = require("../games/fake-answer/canonicalContent");

const fixturePath = path.join(
    __dirname,
    "..",
    "games",
    "fake-answer",
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

test("canonical validation reports missing required fields", () => {
    const candidate = cloneFixture();
    delete candidate.entities[0].name;
    const result = validateCanonicalContent(candidate);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /entities\[0\]\.name is required/);
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

test("canonical validation rejects unsupported schema and record versions", () => {
    const candidate = cloneFixture();
    candidate.schemaVersion = 2;
    candidate.claims[0].recordVersion = 2;
    const result = validateCanonicalContent(candidate);
    assert.match(result.errors.join("\n"), /schemaVersion must be the supported version 1/);
    assert.match(result.errors.join("\n"), /claims\[0\]\.recordVersion must be the supported version 1/);
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
