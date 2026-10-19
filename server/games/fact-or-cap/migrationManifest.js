const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { validateCanonicalContent } = require("./canonicalContent");
const { adaptFactOrCap } = require("./factOrCapAdapter");
const { readPack, validateQuestionPack } = require("./questionLibrary");

const MIGRATION_MANIFEST_VERSION = 1;
const CONTENT_ROOT = path.join(__dirname);
const LEGACY_CONTENT_DIRECTORIES = Object.freeze({
    "fact-or-cap": path.join(CONTENT_ROOT, "content", "general"),
    "fact-or-cap-anime": path.join(CONTENT_ROOT, "content", "anime")
});
const LEGACY_GAME_IDS = new Set(Object.keys(LEGACY_CONTENT_DIRECTORIES));
const MANIFEST_FIELDS = new Set(["schemaVersion", "entries"]);
const ENTRY_FIELDS = new Set(["gameId", "contentPackId", "questionId", "transformationId"]);
const LEGACY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const TRANSFORMATION_ID_PATTERN = /^transform:[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const COMPARISON_FIELDS = Object.freeze([
    ["prompt", "text"],
    ["completion", "correctCompletion"],
    ["category", "category"],
    ["tags", "tags"],
    ["difficulty", "difficulty"],
    ["contentPackId", "contentPackId"],
    ["sourceName", "sourceName"],
    ["sourceUrl", "sourceUrl"]
]);

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadLegacyPacks(contentDirectories) {
    const errors = [];
    const libraries = new Map();
    for (const [gameId, directory] of Object.entries(contentDirectories).sort(([a], [b]) => a.localeCompare(b))) {
        let fileNames;
        try {
            fileNames = fs.readdirSync(directory)
                .filter((fileName) => fileName.endsWith(".json"))
                .sort();
        } catch (error) {
            errors.push(`Unable to read ${gameId} content library "${directory}": ${error.message}`);
            continue;
        }

        const packs = [];
        for (const fileName of fileNames) {
            const filePath = path.join(directory, fileName);
            let data;
            try {
                data = readPack(filePath);
            } catch (error) {
                errors.push(error.message);
                continue;
            }
            const result = validateQuestionPack(data, filePath);
            errors.push(...result.errors);
            packs.push({
                fileName,
                contentPackId: !Array.isArray(data) && typeof data?.contentPackId === "string"
                    ? data.contentPackId
                    : null,
                questions: result.questions
            });
        }
        libraries.set(gameId, packs);
    }
    return { libraries, errors };
}

function compareAdaptedQuestion(legacyQuestion, adaptedQuestion) {
    const differences = [];
    for (const [field, questionField] of COMPARISON_FIELDS) {
        const legacyValue = legacyQuestion[questionField] ?? null;
        const generatedValue = adaptedQuestion[questionField] ?? null;
        if (!isDeepStrictEqual(legacyValue, generatedValue)) {
            differences.push({ field, legacy: legacyValue, generated: generatedValue });
        }
    }
    return differences;
}

function collectReviewMetadata(canonicalContent, provenance) {
    const claimsById = new Map(canonicalContent.claims.map((claim) => [claim.id, claim]));
    const sourcesById = new Map(canonicalContent.sources.map((source) => [source.id, source]));
    const claims = provenance.claimIds.map((id) => claimsById.get(id));
    const sources = provenance.sourceIds.map((id) => sourcesById.get(id));
    return {
        verification: claims.map(({ id, verificationStatus }) => ({
            claimId: id,
            status: verificationStatus
        })),
        claimReview: claims.map(({ id, reviewStatus }) => ({
            claimId: id,
            status: reviewStatus
        })),
        sourceReview: sources.map(({ id, reviewStatus }) => ({
            sourceId: id,
            status: reviewStatus
        })),
        rightsReview: sources.map(({ id, rightsReview }) => ({
            sourceId: id,
            status: rightsReview.status
        })),
        unresolved: {
            unverifiedClaimIds: claims
                .filter(({ verificationStatus }) => verificationStatus !== "verified")
                .map(({ id }) => id),
            unreviewedClaimIds: claims
                .filter(({ reviewStatus }) => reviewStatus !== "reviewed")
                .map(({ id }) => id),
            unreviewedSourceIds: sources
                .filter(({ reviewStatus }) => reviewStatus !== "reviewed")
                .map(({ id }) => id),
            unknownRightsSourceIds: sources
                .filter(({ rightsReview }) => rightsReview.status === "unknown")
                .map(({ id }) => id)
        }
    };
}

function validateMigrationManifest(manifest, canonicalContent, options = {}) {
    const errors = [];
    const entries = [];
    if (!isRecord(manifest)) {
        return { valid: false, matches: false, errors: ["Manifest must be an object."], entries };
    }
    for (const field of Object.keys(manifest)) {
        if (!MANIFEST_FIELDS.has(field)) {
            errors.push(`Manifest has unsupported field "${field}".`);
        }
    }
    if (manifest.schemaVersion !== MIGRATION_MANIFEST_VERSION) {
        errors.push(`schemaVersion must be supported version ${MIGRATION_MANIFEST_VERSION}.`);
    }
    if (!Array.isArray(manifest.entries)) {
        errors.push("entries must be an array.");
        return { valid: false, matches: false, errors, entries };
    }
    if (manifest.entries.length === 0) {
        errors.push("entries must contain at least one mapping.");
    }

    const canonicalValidation = validateCanonicalContent(canonicalContent);
    if (!canonicalValidation.valid) {
        errors.push(...canonicalValidation.errors.map((error) => `Canonical content: ${error}`));
    }
    const { libraries, errors: libraryErrors } = loadLegacyPacks(
        options.contentDirectories ?? LEGACY_CONTENT_DIRECTORIES
    );
    errors.push(...libraryErrors);
    if (!canonicalValidation.valid || libraryErrors.length > 0) {
        return { valid: false, matches: false, errors, entries };
    }

    const entryErrors = new Map();
    const sourceKeys = new Map();
    const transformationIds = new Map();
    const sortedEntries = manifest.entries.map((entry, index) => ({ entry, index }))
        .sort((left, right) => {
            const a = left.entry ?? {};
            const b = right.entry ?? {};
            return [a.gameId, a.contentPackId, a.questionId, a.transformationId]
                .map((value) => typeof value === "string" ? value : "")
                .join("\0")
                .localeCompare([b.gameId, b.contentPackId, b.questionId, b.transformationId]
                    .map((value) => typeof value === "string" ? value : "")
                    .join("\0"));
        });

    for (const { entry, index } of sortedEntries) {
        const itemErrors = [];
        const label = `entries[${index}]`;
        if (!isRecord(entry)) {
            const itemErrors = [`${label} must be an object.`];
            entryErrors.set(index, itemErrors);
            entries.push({ index, valid: false, errors: itemErrors, differences: [] });
            continue;
        }
        for (const field of Object.keys(entry)) {
            if (!ENTRY_FIELDS.has(field)) {
                itemErrors.push(`${label} has unsupported field "${field}"; each entry maps exactly one transformationId.`);
            }
        }
        for (const field of ["gameId", "contentPackId", "questionId", "transformationId"]) {
            if (typeof entry[field] !== "string" || entry[field].trim() === "") {
                itemErrors.push(`${label}.${field} is required and must be a non-empty string.`);
            }
        }
        if (typeof entry.gameId === "string" && !LEGACY_GAME_IDS.has(entry.gameId)) {
            itemErrors.push(`${label}.gameId "${entry.gameId}" is not a registered Fact-or-Cap library ID.`);
        }
        if (typeof entry.contentPackId === "string" && !LEGACY_ID_PATTERN.test(entry.contentPackId)) {
            itemErrors.push(`${label}.contentPackId must use a lowercase letters/numbers/hyphens ID.`);
        }
        if (typeof entry.questionId === "string" && !LEGACY_ID_PATTERN.test(entry.questionId)) {
            itemErrors.push(`${label}.questionId must use a lowercase letters/numbers/hyphens ID.`);
        }
        if (typeof entry.transformationId === "string" && !TRANSFORMATION_ID_PATTERN.test(entry.transformationId)) {
            itemErrors.push(`${label}.transformationId must be a valid transform: ID.`);
        }
        if (itemErrors.length > 0) {
            entryErrors.set(index, itemErrors);
            entries.push({ index, mapping: entry, valid: false, errors: itemErrors, differences: [] });
            continue;
        }

        const sourceKey = `${entry.gameId}\0${entry.contentPackId}\0${entry.questionId}`;
        if (sourceKeys.has(sourceKey)) {
            itemErrors.push(`${label} duplicates a legacy-question mapping already declared in entries[${sourceKeys.get(sourceKey)}].`);
        } else {
            sourceKeys.set(sourceKey, index);
        }
        if (transformationIds.has(entry.transformationId)) {
            itemErrors.push(`${label} duplicates transformation mapping already declared in entries[${transformationIds.get(entry.transformationId)}].`);
        } else {
            transformationIds.set(entry.transformationId, index);
        }

        const matchingPacks = (libraries.get(entry.gameId) ?? [])
            .filter((pack) => pack.contentPackId === entry.contentPackId);
        let legacyQuestion;
        if (matchingPacks.length === 0) {
            itemErrors.push(`${label} cannot resolve contentPackId "${entry.contentPackId}" in game "${entry.gameId}".`);
        } else if (matchingPacks.length > 1) {
            itemErrors.push(`${label} contentPackId "${entry.contentPackId}" is ambiguous in game "${entry.gameId}" (${matchingPacks.length} packs).`);
        } else {
            const matchingQuestions = matchingPacks[0].questions.filter(({ id }) => id === entry.questionId);
            if (matchingQuestions.length === 0) {
                itemErrors.push(`${label} cannot resolve questionId "${entry.questionId}" in pack "${entry.contentPackId}".`);
            } else if (matchingQuestions.length > 1) {
                itemErrors.push(`${label} questionId "${entry.questionId}" is ambiguous in pack "${entry.contentPackId}" (${matchingQuestions.length} questions).`);
            } else {
                legacyQuestion = matchingQuestions[0];
            }
        }

        let adaptedQuestion;
        let provenance;
        if (!canonicalContent.transformations.some(({ id }) => id === entry.transformationId)) {
            itemErrors.push(`${label} cannot resolve transformationId "${entry.transformationId}" in canonical content.`);
        } else {
            try {
                const adapted = adaptFactOrCap(canonicalContent, entry.transformationId, {
                    contentPackId: entry.contentPackId
                });
                adaptedQuestion = adapted.questions[0];
                provenance = adapted.provenanceByQuestionId.get(entry.transformationId);
            } catch (error) {
                itemErrors.push(`${label} transformation "${entry.transformationId}" is not compatible with the Fact-or-Cap adapter: ${error.message}`);
            }
        }

        const differences = legacyQuestion && adaptedQuestion
            ? compareAdaptedQuestion(legacyQuestion, adaptedQuestion)
            : [];
        const resultEntry = {
            index,
            mapping: entry,
            valid: itemErrors.length === 0,
            errors: itemErrors,
            differences,
            matches: differences.length === 0 && itemErrors.length === 0,
            ...(provenance ? { provenance } : {}),
            ...(provenance ? { reviewMetadata: collectReviewMetadata(canonicalContent, provenance) } : {})
        };
        entries.push(resultEntry);
        if (itemErrors.length > 0) entryErrors.set(index, itemErrors);
    }

    entries.sort((a, b) => a.index - b.index);
    const allErrors = [...errors, ...[...entryErrors.entries()]
        .sort(([a], [b]) => a - b)
        .flatMap(([, itemErrors]) => itemErrors)];
    return {
        valid: allErrors.length === 0,
        matches: allErrors.length === 0 && entries.every(({ matches: isMatch }) => isMatch),
        errors: allErrors,
        entries
    };
}

module.exports = {
    LEGACY_CONTENT_DIRECTORIES,
    LEGACY_GAME_IDS,
    MIGRATION_MANIFEST_VERSION,
    compareAdaptedQuestion,
    validateMigrationManifest
};
