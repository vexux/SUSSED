const { validateCanonicalContent } = require("./canonicalContent");
const { validateQuestionPack } = require("./questionLibrary");

const FACT_OR_CAP_FORMAT_ID = "fact-or-cap.completion.v1";

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function adaptFactOrCap(canonicalContent, selectedTransformationIds, options = {}) {
    const canonicalValidation = validateCanonicalContent(canonicalContent);
    if (!canonicalValidation.valid) {
        throw new Error(`Canonical content is invalid:\n${canonicalValidation.errors.join("\n")}`);
    }
    if (!isRecord(options)) {
        throw new TypeError("Adapter options must be an object.");
    }

    const requestedIds = typeof selectedTransformationIds === "string"
        ? [selectedTransformationIds]
        : selectedTransformationIds;
    if (!Array.isArray(requestedIds) || requestedIds.length === 0 ||
        requestedIds.some((id) => typeof id !== "string" || id.trim() === "")) {
        throw new TypeError("Select one or more transformation IDs.");
    }
    if (new Set(requestedIds).size !== requestedIds.length) {
        throw new Error("Selected transformation IDs must be unique.");
    }
    if (options.contentPackId !== undefined &&
        (typeof options.contentPackId !== "string" || options.contentPackId.trim() === "")) {
        throw new TypeError("contentPackId must be a non-empty string when supplied.");
    }

    const transformationsById = new Map();
    for (const transformation of canonicalContent.transformations) {
        const matches = transformationsById.get(transformation.id) ?? [];
        matches.push(transformation);
        transformationsById.set(transformation.id, matches);
    }
    const claimsById = new Map(canonicalContent.claims.map((claim) => [claim.id, claim]));
    const entitiesById = new Map(canonicalContent.entities.map((entity) => [entity.id, entity]));
    const sourcesById = new Map(canonicalContent.sources.map((source) => [source.id, source]));
    const transformations = [...requestedIds].sort().map((id) => {
        const matches = transformationsById.get(id) ?? [];
        if (matches.length === 0) {
            throw new Error(`Transformation "${id}" was not found in canonical content.`);
        }
        if (matches.length > 1) {
            throw new Error(`Transformation ID "${id}" is ambiguous; canonical IDs must be unique.`);
        }
        const transformation = matches[0];
        if (transformation.gameFormatId !== FACT_OR_CAP_FORMAT_ID) {
            throw new Error(
                `Transformation "${id}" uses unsupported format "${transformation.gameFormatId}"; expected "${FACT_OR_CAP_FORMAT_ID}".`
            );
        }
        if (transformation.claimIds.length !== 1) {
            throw new Error(
                `Transformation "${id}" must reference exactly one claim to produce an unambiguous Fact-or-Cap answer.`
            );
        }

        const claim = claimsById.get(transformation.claimIds[0]);
        if (!claim) {
            throw new Error(`Transformation "${id}" references missing claim "${transformation.claimIds[0]}".`);
        }
        const entityIds = [...transformation.entityIds].sort();
        const entities = entityIds.map((entityId) => {
            const entity = entitiesById.get(entityId);
            if (!entity) {
                throw new Error(`Transformation "${id}" references missing entity "${entityId}".`);
            }
            if (!claim.entityIds.includes(entityId)) {
                throw new Error(`Transformation "${id}" entity "${entityId}" is not linked through its claim.`);
            }
            return entity;
        });
        const sourceIds = [...claim.sourceIds].sort();
        const sources = sourceIds.map((sourceId) => {
            const source = sourcesById.get(sourceId);
            if (!source) {
                throw new Error(`Claim "${claim.id}" references missing source "${sourceId}".`);
            }
            return source;
        });
        if (sources.length === 0) {
            throw new Error(`Claim "${claim.id}" has no source for playable question attribution.`);
        }

        const payload = transformation.payload;
        if (!isRecord(payload) || typeof payload.text !== "string" || payload.text.trim() === "") {
            throw new Error(`Transformation "${id}" requires a non-empty payload.text prompt.`);
        }
        let primarySource;
        if (payload.sourceId !== undefined) {
            if (typeof payload.sourceId !== "string" || !payload.sourceId.trim()) {
                throw new Error(`Transformation "${id}" payload.sourceId must be a non-empty source ID.`);
            }
            if (!claim.sourceIds.includes(payload.sourceId)) {
                throw new Error(`Transformation "${id}" payload.sourceId must reference a source linked to claim "${claim.id}".`);
            }
            primarySource = sourcesById.get(payload.sourceId);
        } else if (sources.length === 1) {
            primarySource = sources[0];
        } else {
            throw new Error(
                `Transformation "${id}" must set payload.sourceId to choose attribution from its ${sources.length} linked sources.`
            );
        }
        const hasLiteralAnswer = Object.hasOwn(payload, "correctCompletion");
        const hasEntityAnswer = Object.hasOwn(payload, "answerEntityId");
        if (hasLiteralAnswer === hasEntityAnswer) {
            throw new Error(
                `Transformation "${id}" must provide exactly one of payload.correctCompletion or payload.answerEntityId.`
            );
        }
        let correctCompletion;
        if (hasLiteralAnswer) {
            correctCompletion = payload.correctCompletion;
        } else {
            if (typeof payload.answerEntityId !== "string" || !payload.answerEntityId.trim()) {
                throw new Error(`Transformation "${id}" payload.answerEntityId must be a non-empty entity ID.`);
            }
            const answerEntity = entitiesById.get(payload.answerEntityId);
            if (!answerEntity) {
                throw new Error(`Transformation "${id}" references missing answer entity "${payload.answerEntityId}".`);
            }
            if (!transformation.entityIds.includes(payload.answerEntityId) ||
                !claim.entityIds.includes(payload.answerEntityId)) {
                throw new Error(`Transformation "${id}" answer entity must be linked through its claim and entityIds.`);
            }
            correctCompletion = answerEntity.name;
        }

        return {
            question: {
                id: transformation.id,
                text: payload.text,
                correctCompletion,
                sourceName: primarySource.title,
                sourceUrl: primarySource.url,
                ...(payload.category === undefined ? {} : { category: payload.category }),
                ...(payload.tags === undefined ? {} : { tags: payload.tags }),
                ...(payload.difficulty === undefined ? {} : { difficulty: payload.difficulty }),
                ...(options.contentPackId === undefined ? {} : { contentPackId: options.contentPackId }),
            },
            provenance: {
                transformationId: transformation.id,
                claimIds: [claim.id],
                entityIds: entities.map(({ id: entityId }) => entityId),
                sourceIds,
                primarySourceId: primarySource.id,
            },
        };
    });

    const questions = transformations.map(({ question }) => question);
    const packValidation = validateQuestionPack({
        ...(options.contentPackId === undefined ? {} : { contentPackId: options.contentPackId }),
        questions,
    }, "Fact-or-Cap canonical adapter output");
    if (packValidation.errors.length > 0) {
        throw new Error(`Adapted questions are invalid:\n${packValidation.errors.join("\n")}`);
    }
    const provenanceByQuestionId = new Map(transformations.map(({ provenance }) =>
        [provenance.transformationId, provenance]
    ));
    return { questions: packValidation.questions, provenanceByQuestionId };
}

module.exports = { FACT_OR_CAP_FORMAT_ID, adaptFactOrCap };
