const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateCanonicalContent } = require("../games/fact-or-cap/canonicalContent");
const { adaptFactOrCap } = require("../games/fact-or-cap/factOrCapAdapter");
const { validateMigrationManifest } = require("../games/fact-or-cap/migrationManifest");

const contentPath = path.join(
    __dirname,
    "..",
    "games",
    "fact-or-cap",
    "content-canonical",
    "content-migration-pilot.json"
);
const manifestPath = path.join(
    __dirname,
    "..",
    "games",
    "fact-or-cap",
    "content-canonical",
    "content-migration-pilot-manifest.json"
);
const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

test("five-question migration pilot validates with exact legacy parity and explicit traceability", () => {
    assert.deepEqual(validateCanonicalContent(content), { valid: true, errors: [] });

    const result = validateMigrationManifest(manifest, content);
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.matches, true);
    assert.equal(result.entries.length, 5);
    assert.ok(result.entries.every(({ differences, valid, matches }) =>
        valid && matches && differences.length === 0
    ));

    const adapted = adaptFactOrCap(
        content,
        manifest.entries.map(({ transformationId }) => transformationId)
    );
    assert.equal(adapted.questions.length, 5);
    for (const entry of manifest.entries) {
        const provenance = adapted.provenanceByQuestionId.get(entry.transformationId);
        assert.ok(provenance, `Expected provenance for ${entry.transformationId}`);
        assert.equal(provenance.transformationId, entry.transformationId);
        assert.ok(provenance.claimIds.length > 0);
        assert.ok(provenance.sourceIds.length > 0);
    }
});

test("shares the Mercury entity while keeping its two factual claims distinct", () => {
    const mercuryClaims = content.claims.filter(({ entityIds }) => entityIds.includes("entity:mercury"));
    assert.equal(content.entities.filter(({ id }) => id === "entity:mercury").length, 1);
    assert.deepEqual(
        mercuryClaims.map(({ id }) => id).sort(),
        ["claim:mercury-nearest-sun", "claim:mercury-orbital-period-88-earth-days"]
    );
    assert.notEqual(mercuryClaims[0].statement, mercuryClaims[1].statement);
    assert.notDeepEqual(mercuryClaims[0].sourceIds, mercuryClaims[1].sourceIds);
});

test("records literal numeric completions and entity-resolved exact-name completions", () => {
    const numeric = content.transformations.find(({ id }) => id === "transform:legacy-mercury-shortest-year");
    const entityResolved = content.transformations.find(({ id }) => id === "transform:legacy-one-piece-nami");
    assert.equal(numeric.payload.correctCompletion, "88");
    assert.equal(Object.hasOwn(numeric.payload, "answerEntityId"), false);
    assert.equal(entityResolved.payload.answerEntityId, "entity:nami");
    assert.equal(content.entities.find(({ id }) => id === "entity:nami").name, "Nami");
});

test("manifest retains the exact legacy game, pack, question, and transformation links", () => {
    const mappings = manifest.entries.map(({ gameId, contentPackId, questionId, transformationId }) =>
        [gameId, contentPackId, questionId, transformationId]
    );
    assert.deepEqual(mappings, [
        ["fact-or-cap", "general-facts-batch-2026-10", "mercury-nearest-sun", "transform:legacy-mercury-nearest-sun"],
        ["fact-or-cap", "general-facts-batch-2026-10", "mercury-shortest-year", "transform:legacy-mercury-shortest-year"],
        ["fact-or-cap", "general-facts-batch-2026-10", "ocean-earth-surface", "transform:legacy-ocean-earth-surface"],
        ["fact-or-cap", "general-facts-batch-2026-10", "octopus-ink-defense", "transform:legacy-octopus-ink-defense"],
        ["fact-or-cap-anime", "anime-facts-batch-2026-10", "one-piece-nami", "transform:legacy-one-piece-nami"]
    ]);
});
