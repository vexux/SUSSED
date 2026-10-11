const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateCanonicalContent } = require("../games/fake-answer/canonicalContent");
const { FACT_OR_CAP_FORMAT_ID, adaptFactOrCap } = require("../games/fake-answer/factOrCapAdapter");

const fixturePath = path.join(
    __dirname,
    "..",
    "games",
    "fake-answer",
    "content-canonical",
    "pilot.json"
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const factOrCapTransformationId = "transform:sailor-moon-bluff-completion";

function cloneFixture() {
    return structuredClone(fixture);
}

test("adapts the pilot transformation into a legacy playable question with traceability", () => {
    assert.equal(validateCanonicalContent(fixture).valid, true);
    const adapted = adaptFactOrCap(fixture, factOrCapTransformationId, {
        contentPackId: "canonical-anime-pilot",
    });

    assert.deepEqual(adapted.questions, [{
        id: factOrCapTransformationId,
        text: "In Toei Animation's Sailor Moon series description, the talking cat who gives Usagi a transformation brooch is",
        correctCompletion: "Luna",
        sourceName: "Toei Animation — Sailor Moon",
        sourceUrl: "https://www.toei-animation.com/catalog/sailor-moon/",
        category: "anime",
        tags: ["Sailor Moon", "official-anime-series"],
        difficulty: "easy",
        contentPackId: "canonical-anime-pilot",
    }]);
    assert.deepEqual(adapted.provenanceByQuestionId.get(factOrCapTransformationId), {
        transformationId: factOrCapTransformationId,
        claimIds: ["claim:sailor-moon-talking-cat"],
        entityIds: ["entity:luna", "entity:sailor-moon"],
        sourceIds: ["source:toei-sailor-moon"],
        primarySourceId: "source:toei-sailor-moon",
    });
    assert.equal(Object.hasOwn(adapted.questions[0], "provenance"), false);
});

test("adapts multiple compatible transformations and resolves every source ID", () => {
    const candidate = cloneFixture();
    candidate.transformations[1].gameFormatId = FACT_OR_CAP_FORMAT_ID;
    candidate.transformations[1].payload = {
        text: "Which character is described as Sailor Moon's talking cat?",
        answerEntityId: "entity:luna",
    };
    candidate.sources.push({
        id: "source:zz-secondary-reference",
        title: "Synthetic secondary source",
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
            notes: "Synthetic test source; source support is not asserted."
        }
    });
    candidate.claims[0].sourceIds.push("source:zz-secondary-reference");
    const ids = [factOrCapTransformationId, "transform:sailor-moon-flashcard"];
    assert.throws(
        () => adaptFactOrCap(candidate, ids),
        /must set payload.sourceId to choose attribution from its 2 linked sources/
    );
    candidate.transformations[0].payload.sourceId = "source:toei-sailor-moon";
    candidate.transformations[1].payload.sourceId = "source:toei-sailor-moon";
    const adapted = adaptFactOrCap(candidate, ids);

    assert.equal(adapted.questions.length, 2);
    assert.deepEqual(adapted.questions.map(({ id }) => id), [...ids].sort());
    assert.deepEqual(
        adapted.provenanceByQuestionId.get(factOrCapTransformationId).sourceIds,
        ["source:toei-sailor-moon", "source:zz-secondary-reference"]
    );
    assert.equal(adapted.questions[0].sourceName, "Toei Animation — Sailor Moon");
});

test("adapter output is deterministic regardless of canonical record and selection order", () => {
    const first = adaptFactOrCap(fixture, [factOrCapTransformationId]);
    const reordered = cloneFixture();
    reordered.entities.reverse();
    reordered.claims.reverse();
    reordered.sources.reverse();
    reordered.transformations.reverse();
    const second = adaptFactOrCap(reordered, [factOrCapTransformationId]);

    assert.deepEqual(second, first);
});

test("supports literal completions when an answer is not represented by an entity", () => {
    const candidate = cloneFixture();
    delete candidate.transformations[0].payload.answerEntityId;
    candidate.transformations[0].payload.correctCompletion = "a literal answer";
    const adapted = adaptFactOrCap(candidate, factOrCapTransformationId);
    assert.equal(adapted.questions[0].correctCompletion, "a literal answer");
});

test("rejects a transformation with an unsupported game format", () => {
    assert.throws(
        () => adaptFactOrCap(fixture, "transform:sailor-moon-flashcard"),
        /uses unsupported format "study\.flashcard\.v1"/
    );
});

test("rejects missing and ambiguous transformation selections", () => {
    assert.throws(
        () => adaptFactOrCap(fixture, "transform:missing"),
        /Transformation "transform:missing" was not found/
    );
    assert.throws(
        () => adaptFactOrCap(fixture, [factOrCapTransformationId, factOrCapTransformationId]),
        /Selected transformation IDs must be unique/
    );
    const duplicate = cloneFixture();
    duplicate.transformations.push(structuredClone(duplicate.transformations[0]));
    assert.throws(
        () => adaptFactOrCap(duplicate, factOrCapTransformationId),
        /duplicates transformations\[0\]/
    );
});

test("rejects malformed canonical references and missing prompt or answer values", () => {
    const missingEntity = cloneFixture();
    missingEntity.entities = missingEntity.entities.filter(({ id }) => id !== "entity:luna");
    assert.throws(
        () => adaptFactOrCap(missingEntity, factOrCapTransformationId),
        /Canonical content is invalid:.*references unknown ID entity:luna/s
    );

    const missingPrompt = cloneFixture();
    delete missingPrompt.transformations[0].payload.text;
    assert.throws(
        () => adaptFactOrCap(missingPrompt, factOrCapTransformationId),
        /requires a non-empty payload\.text prompt/
    );

    const missingAnswer = cloneFixture();
    delete missingAnswer.transformations[0].payload.answerEntityId;
    assert.throws(
        () => adaptFactOrCap(missingAnswer, factOrCapTransformationId),
        /must provide exactly one of payload\.correctCompletion or payload\.answerEntityId/
    );

    const ambiguousAnswer = cloneFixture();
    ambiguousAnswer.transformations[0].payload.correctCompletion = "Luna";
    assert.throws(
        () => adaptFactOrCap(ambiguousAnswer, factOrCapTransformationId),
        /must provide exactly one of payload\.correctCompletion or payload\.answerEntityId/
    );

    const unrelatedSource = cloneFixture();
    unrelatedSource.transformations[0].payload.sourceId = "source:missing";
    assert.throws(
        () => adaptFactOrCap(unrelatedSource, factOrCapTransformationId),
        /payload\.sourceId must reference a source linked to claim/
    );

    const malformedMetadata = cloneFixture();
    malformedMetadata.transformations[0].payload.difficulty = "expert";
    assert.throws(
        () => adaptFactOrCap(malformedMetadata, factOrCapTransformationId),
        /difficulty must be "easy", "medium", or "hard"/
    );
});
