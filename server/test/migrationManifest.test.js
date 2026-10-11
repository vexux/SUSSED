const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const animeQuestionBank = require("../games/fake-answer/animeQuestionBank");
const { LEGACY_CONTENT_DIRECTORIES, validateMigrationManifest } = require("../games/fake-answer/migrationManifest");
const generalQuestionBank = require("../games/fake-answer/questionBank");

const pilotPath = path.join(
    __dirname,
    "..",
    "games",
    "fake-answer",
    "content-canonical",
    "pilot.json"
);
const sailorMoonPilot = JSON.parse(fs.readFileSync(pilotPath, "utf8"));

function findQuestion(bank, id) {
    const question = bank.questions.find((entry) => entry.id === id);
    assert.ok(question, `Expected question "${id}" in fixture bank.`);
    return question;
}

function makeCanonicalForQuestion(question, { literal = false, suffix = question.id } = {}) {
    const answerEntityId = `entity:${suffix}-answer`;
    const subjectEntityId = `entity:${suffix}-subject`;
    const sourceId = `source:${suffix}-source`;
    const claimId = `claim:${suffix}-claim`;
    const transformationId = `transform:${suffix}-transform`;
    const payload = {
        text: question.text,
        sourceId,
        ...(literal ? { correctCompletion: question.correctCompletion } : { answerEntityId }),
        ...(question.category === undefined ? {} : { category: question.category }),
        ...(question.tags === undefined ? {} : { tags: question.tags }),
        ...(question.difficulty === undefined ? {} : { difficulty: question.difficulty })
    };
    return {
        schemaVersion: 1,
        entities: [
            { id: answerEntityId, kind: "other", name: question.correctCompletion, reviewStatus: "unreviewed" },
            { id: subjectEntityId, kind: "concept", name: `Subject for ${question.id}`, reviewStatus: "unreviewed" }
        ],
        claims: [{
            id: claimId,
            statement: `Unverified test claim for ${question.id}.`,
            entityIds: [subjectEntityId, answerEntityId],
            sourceIds: [sourceId],
            verificationStatus: "unverified",
            reviewStatus: "unreviewed"
        }],
        sources: [{
            id: sourceId,
            title: question.sourceName,
            url: question.sourceUrl,
            publisher: null,
            creator: null,
            accessedAt: null,
            reviewStatus: "unreviewed",
            rightsReview: {
                status: "unknown",
                license: null,
                reviewedAt: null,
                reviewerId: null,
                notes: "Test metadata only; factual support and reuse permission are not asserted."
            }
        }],
        transformations: [{
            id: transformationId,
            gameFormatId: "fact-or-cap.completion.v1",
            entityIds: [subjectEntityId, answerEntityId],
            claimIds: [claimId],
            reviewStatus: "unreviewed",
            payload
        }]
    };
}

function combineCanonical(...documents) {
    return {
        schemaVersion: 1,
        entities: documents.flatMap(({ entities }) => entities),
        claims: documents.flatMap(({ claims }) => claims),
        sources: documents.flatMap(({ sources }) => sources),
        transformations: documents.flatMap(({ transformations }) => transformations)
    };
}

function mapping(gameId, question, transformationId) {
    return {
        gameId,
        contentPackId: question.contentPackId,
        questionId: question.id,
        transformationId
    };
}

function makeWorkspace(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-migration-manifest-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

test("validates matching mappings for both registered game variants", () => {
    const general = findQuestion(generalQuestionBank, "mercury-nearest-sun");
    const anime = findQuestion(animeQuestionBank, "anime-sailor-moon-luna");
    const generalCanonical = makeCanonicalForQuestion(general);
    const manifest = {
        schemaVersion: 1,
        entries: [
            mapping("fact-or-cap", general, generalCanonical.transformations[0].id),
            mapping("fact-or-cap-anime", anime, "transform:sailor-moon-bluff-completion")
        ]
    };
    const result = validateMigrationManifest(
        manifest,
        combineCanonical(sailorMoonPilot, generalCanonical)
    );

    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.matches, true);
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.entries.map(({ differences }) => differences), [[], []]);
    const animeEntry = result.entries.find(({ mapping: item }) => item.questionId === anime.id);
    assert.deepEqual(animeEntry.reviewMetadata.unresolved.unknownRightsSourceIds, ["source:toei-sailor-moon"]);
    assert.deepEqual(animeEntry.reviewMetadata.unresolved.unverifiedClaimIds, ["claim:sailor-moon-talking-cat"]);
});

test("supports literal completions without requiring an answer entity", () => {
    const question = findQuestion(generalQuestionBank, "mercury-shortest-year");
    const canonical = makeCanonicalForQuestion(question, { literal: true });
    const result = validateMigrationManifest({
        schemaVersion: 1,
        entries: [mapping("fact-or-cap", question, canonical.transformations[0].id)]
    }, canonical);

    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.matches, true);
    assert.equal(result.entries[0].provenance.entityIds.includes("entity:mercury-shortest-year-answer"), true);
});

test("reports missing legacy questions and missing canonical transformations", () => {
    const question = findQuestion(generalQuestionBank, "mercury-nearest-sun");
    const canonical = makeCanonicalForQuestion(question);
    const result = validateMigrationManifest({
        schemaVersion: 1,
        entries: [
            { ...mapping("fact-or-cap", question, "transform:missing"), questionId: "missing-question" },
            mapping("fact-or-cap", question, "transform:missing")
        ]
    }, canonical);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('cannot resolve questionId "missing-question"')));
    assert.ok(result.errors.some((error) => error.includes('cannot resolve transformationId "transform:missing"')));
});

test("rejects unsupported versions, invalid IDs, and duplicate source or transformation mappings", () => {
    const question = findQuestion(generalQuestionBank, "mercury-nearest-sun");
    const canonical = makeCanonicalForQuestion(question);
    const entry = mapping("fact-or-cap", question, canonical.transformations[0].id);
    const duplicate = validateMigrationManifest({ schemaVersion: 1, entries: [entry, entry] }, canonical);
    assert.ok(duplicate.errors.some((error) => error.includes("duplicates a legacy-question mapping")));
    assert.ok(duplicate.errors.some((error) => error.includes("duplicates transformation mapping")));

    const invalid = validateMigrationManifest({
        schemaVersion: 7,
        entries: [{ ...entry, contentPackId: "Bad Pack", questionId: "bad/id", transformationId: "not-a-transform" }]
    }, canonical);
    assert.ok(invalid.errors.some((error) => error.includes("schemaVersion must be supported version 1")));
    assert.ok(invalid.errors.some((error) => error.includes("contentPackId must use a lowercase")));
    assert.ok(invalid.errors.some((error) => error.includes("questionId must use a lowercase")));
    assert.ok(invalid.errors.some((error) => error.includes("transformationId must be a valid transform: ID")));
    const multipleTransformations = validateMigrationManifest({
        schemaVersion: 1,
        entries: [{ ...entry, transformationIds: [entry.transformationId, "transform:another"] }]
    }, canonical);
    assert.ok(multipleTransformations.errors.some((error) => error.includes("maps exactly one transformationId")));
});

test("rejects ambiguous legacy pack references", (t) => {
    const root = makeWorkspace(t);
    const generalDirectory = path.join(root, "general");
    fs.mkdirSync(generalDirectory);
    const question = findQuestion(generalQuestionBank, "mercury-nearest-sun");
    const pack = { contentPackId: "duplicate-pack", questions: [{ ...question }] };
    fs.writeFileSync(path.join(generalDirectory, "one.json"), JSON.stringify(pack));
    fs.writeFileSync(path.join(generalDirectory, "two.json"), JSON.stringify(pack));
    const canonical = makeCanonicalForQuestion(question);
    const result = validateMigrationManifest({
        schemaVersion: 1,
        entries: [mapping("fact-or-cap", { ...question, contentPackId: "duplicate-pack" }, canonical.transformations[0].id)]
    }, canonical, {
        contentDirectories: {
            ...LEGACY_CONTENT_DIRECTORIES,
            "fact-or-cap": generalDirectory
        }
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('contentPackId "duplicate-pack" is ambiguous')));
});

test("requires an explicit primary source when a claim has multiple sources", () => {
    const question = findQuestion(animeQuestionBank, "anime-sailor-moon-luna");
    const canonical = structuredClone(sailorMoonPilot);
    canonical.sources.push({
        id: "source:secondary-pilot-source",
        title: "Secondary source",
        url: "https://example.org/secondary",
        publisher: null,
        creator: null,
        accessedAt: null,
        reviewStatus: "unreviewed",
        rightsReview: {
            status: "unknown",
            license: null,
            reviewedAt: null,
            reviewerId: null,
            notes: "Test record only; support and reuse terms are not assessed."
        }
    });
    canonical.claims[0].sourceIds.push("source:secondary-pilot-source");
    delete canonical.transformations[0].payload.sourceId;
    const entry = mapping("fact-or-cap-anime", question, "transform:sailor-moon-bluff-completion");
    const manifest = { schemaVersion: 1, entries: [entry] };

    const noSelection = validateMigrationManifest(manifest, canonical);
    assert.equal(noSelection.valid, false);
    assert.ok(noSelection.errors.some((error) => error.includes("must set payload.sourceId")));

    canonical.transformations[0].payload.sourceId = "source:toei-sailor-moon";
    const selected = validateMigrationManifest(manifest, canonical);
    assert.equal(selected.valid, true, selected.errors.join("\n"));
    assert.equal(selected.matches, true);
    assert.deepEqual(
        selected.entries[0].provenance.sourceIds,
        ["source:secondary-pilot-source", "source:toei-sailor-moon"]
    );
    assert.equal(selected.entries[0].provenance.primarySourceId, "source:toei-sailor-moon");
});

test("reports field-by-field differences without rewriting either record", (t) => {
    const root = makeWorkspace(t);
    const sourcePack = path.join(LEGACY_CONTENT_DIRECTORIES["fact-or-cap"], "general-facts-batch-2026-10.json");
    const sourceData = JSON.parse(fs.readFileSync(sourcePack, "utf8"));
    const question = sourceData.questions.find(({ id }) => id === "mercury-nearest-sun");
    question.contentPackId = "question-level-pack";
    const generalDirectory = path.join(root, "general");
    fs.mkdirSync(generalDirectory);
    fs.writeFileSync(path.join(generalDirectory, "pilot.json"), JSON.stringify(sourceData));
    const canonical = makeCanonicalForQuestion(question);
    const transformation = canonical.transformations[0];
    transformation.payload.text = "Changed prompt ____";
    transformation.payload.correctCompletion = "Different answer";
    delete transformation.payload.answerEntityId;
    transformation.payload.category = "changed-category";
    transformation.payload.tags = ["changed-tag"];
    transformation.payload.difficulty = "hard";
    canonical.sources.push({
        id: "source:changed-attribution",
        title: "Changed source title",
        url: "https://example.org/changed-source",
        publisher: null,
        creator: null,
        accessedAt: null,
        reviewStatus: "unreviewed",
        rightsReview: {
            status: "unknown",
            license: null,
            reviewedAt: null,
            reviewerId: null,
            notes: "Test record only."
        }
    });
    canonical.claims[0].sourceIds.push("source:changed-attribution");
    transformation.payload.sourceId = "source:changed-attribution";
    const result = validateMigrationManifest({
        schemaVersion: 1,
        entries: [mapping("fact-or-cap", { ...question, contentPackId: "general-facts-batch-2026-10" }, transformation.id)]
    }, canonical, {
        contentDirectories: {
            ...LEGACY_CONTENT_DIRECTORIES,
            "fact-or-cap": generalDirectory
        }
    });

    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.matches, false);
    assert.deepEqual(result.entries[0].differences.map(({ field }) => field), [
        "prompt", "completion", "category", "tags", "difficulty", "contentPackId", "sourceName", "sourceUrl"
    ]);
    assert.equal(question.text, "The planet closest to the Sun is ____.");
    assert.equal(transformation.payload.text, "Changed prompt ____");
});

test("validation output is deterministic for the same manifest and canonical input", () => {
    const question = findQuestion(animeQuestionBank, "anime-sailor-moon-luna");
    const manifest = {
        schemaVersion: 1,
        entries: [mapping("fact-or-cap-anime", question, "transform:sailor-moon-bluff-completion")]
    };
    assert.deepEqual(
        validateMigrationManifest(manifest, sailorMoonPilot),
        validateMigrationManifest(manifest, sailorMoonPilot)
    );
});
