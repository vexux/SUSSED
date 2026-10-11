const fs = require("node:fs");
const path = require("node:path");
const { validateCanonicalContent } = require("./canonicalContent");
const { adaptFactOrCap } = require("./factOrCapAdapter");
const { evaluateReadiness } = require("./reviewDecisionManifest");
const { LEGACY_CONTENT_DIRECTORIES, validateMigrationManifest } = require("./migrationManifest");
const { readPack, validateQuestionPack } = require("./questionLibrary");
const { TASK_10_IDENTITIES, validateSourceReviewFindings } = require("./sourceReviewFindings");

const REVIEW_PACKET_VERSION = 1;
const CANDIDATE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCandidateManifest(data) {
    const errors = [];
    if (!isRecord(data)) return { valid: false, errors: ["Candidate plan must be an object."], items: [] };
    if (data.schemaVersion !== 1) errors.push("Candidate plan schemaVersion must be 1.");
    if (!Array.isArray(data.items) || data.items.length === 0) {
        errors.push("Candidate plan items must be a non-empty array.");
        return { valid: false, errors, items: [] };
    }
    const seen = new Set();
    const items = [];
    data.items.forEach((entry, index) => {
        const label = `items[${index}]`;
        if (!isRecord(entry)) {
            errors.push(`${label} must be an object.`);
            return;
        }
        for (const field of ["gameId", "contentPackId", "questionId"]) {
            if (typeof entry[field] !== "string" || !CANDIDATE_ID.test(entry[field])) errors.push(`${label}.${field} must be a stable lowercase ID.`);
        }
        if (entry.reviewFocus !== undefined && typeof entry.reviewFocus !== "string") errors.push(`${label}.reviewFocus must be a string when supplied.`);
        const key = [entry.gameId, entry.contentPackId, entry.questionId].join("\0");
        if (seen.has(key)) errors.push(`${label} duplicates legacy candidate ${entry.gameId}/${entry.contentPackId}/${entry.questionId}.`);
        seen.add(key);
        items.push({ ...entry, index });
    });
    return { valid: errors.length === 0, errors, items };
}

function loadLegacyLibraries(contentDirectories = LEGACY_CONTENT_DIRECTORIES) {
    const libraries = new Map();
    const errors = [];
    for (const [gameId, directory] of Object.entries(contentDirectories).sort(([a], [b]) => a.localeCompare(b))) {
        let files;
        try {
            files = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
        } catch (error) {
            errors.push(`Unable to read ${gameId} content library "${directory}": ${error.message}`);
            libraries.set(gameId, []);
            continue;
        }
        const packs = files.map((fileName) => {
            const filePath = path.join(directory, fileName);
            try {
                const data = readPack(filePath);
                const validation = validateQuestionPack(data, filePath);
                errors.push(...validation.errors);
                return {
                    fileName,
                    contentPackId: !Array.isArray(data) && typeof data?.contentPackId === "string" ? data.contentPackId : null,
                    questions: validation.questions
                };
            } catch (error) {
                errors.push(error.message);
                return { fileName, contentPackId: null, questions: [] };
            }
        });
        libraries.set(gameId, packs);
    }
    return { libraries, errors };
}

function resolveLegacyCandidate(candidate, libraries) {
    const packs = (libraries.get(candidate.gameId) ?? []).filter((pack) => pack.contentPackId === candidate.contentPackId);
    if (packs.length === 0) return { status: "missing-pack", errors: [`No pack with ID ${candidate.contentPackId} exists in ${candidate.gameId}.`] };
    if (packs.length > 1) return { status: "ambiguous-pack", errors: [`${packs.length} packs use ID ${candidate.contentPackId} in ${candidate.gameId}.`] };
    const questions = packs[0].questions.filter((question) => question.id === candidate.questionId);
    if (questions.length === 0) return { status: "missing-question", packFile: packs[0].fileName, errors: [`Question ${candidate.questionId} was not found in pack ${candidate.contentPackId}.`] };
    if (questions.length > 1) return { status: "ambiguous-question", packFile: packs[0].fileName, errors: [`${questions.length} questions use ID ${candidate.questionId} in pack ${candidate.contentPackId}.`] };
    return { status: "resolved", packFile: packs[0].fileName, question: questions[0], errors: [] };
}

function mappingMatches(entry, candidate) {
    return entry?.gameId === candidate.gameId && entry?.contentPackId === candidate.contentPackId && entry?.questionId === candidate.questionId;
}

function sourceReviewSnapshot(candidate, validation, provided) {
    const inScope = TASK_10_IDENTITIES.some((identity) => mappingMatches(identity, candidate));
    if (!inScope) return { status: "not-in-scope", observations: [], errors: [] };
    if (!provided) return { status: "not-provided", observations: [], errors: [] };
    const key = [candidate.gameId, candidate.contentPackId, candidate.questionId].join("\0");
    if (validation.ambiguousPlanIdentities.has(key)) {
        return { status: "ambiguous", observations: [], errors: ["Candidate plan contains this legacy identity more than once."] };
    }
    const matches = validation.byIdentity.get(key) ?? [];
    if (matches.length > 1) return { status: "ambiguous", observations: [], errors: [`${matches.length} source-review entries match this exact legacy identity.`] };
    if (matches.length === 0) return validation.readable
        ? { status: "missing", observations: [], errors: ["No source-review findings entry matches this exact legacy identity."] }
        : { status: "invalid", observations: [], errors: validation.errors };
    const match = matches[0];
    const errors = [...match.errors];
    if (!validation.valid) errors.push("The source-review findings artifact has validation errors; observations remain non-authoritative.");
    return {
        status: errors.length > 0 ? "invalid" : "present",
        observations: match.errors.length === 0 && Array.isArray(match.item.observations) ? match.item.observations : [],
        errors: [...new Set(errors)].sort()
    };
}

function findCanonicalContext(transformation, canonical) {
    const entities = new Map(canonical.entities.map((record) => [record.id, record]));
    const claims = new Map(canonical.claims.map((record) => [record.id, record]));
    const sources = new Map(canonical.sources.map((record) => [record.id, record]));
    const claimRecords = (transformation.claimIds ?? []).map((id) => claims.get(id)).filter(Boolean);
    const entityIds = [...new Set([
        ...(transformation.entityIds ?? []),
        ...claimRecords.flatMap((claim) => claim.entityIds ?? [])
    ])].sort();
    const sourceIds = [...new Set(claimRecords.flatMap((claim) => claim.sourceIds ?? []))].sort();
    return {
        claims: claimRecords.map(({ id, statement, entityIds: linkedEntities, sourceIds: linkedSources, verificationStatus, reviewStatus }) => ({
            id, statement, entityIds: [...linkedEntities], sourceIds: [...linkedSources], verificationStatus, reviewStatus
        })),
        entities: entityIds.map((id) => {
            const entity = entities.get(id);
            return entity ? { id, name: entity.name, kind: entity.kind } : { id, missing: true };
        }),
        sources: sourceIds.map((id) => {
            const source = sources.get(id);
            return source ? {
                id,
                title: source.title,
                url: source.url,
                publisher: source.publisher ?? null,
                creator: source.creator ?? null,
                accessedAt: source.accessedAt,
                recordReviewStatus: source.reviewStatus,
                canonicalRightsStatus: source.rightsReview?.status ?? "missing"
            } : { id, missing: true };
        })
    };
}

function decisionSnapshot(reviewManifest, transformId) {
    const matches = (Array.isArray(reviewManifest?.items) ? reviewManifest.items : [])
        .filter((item) => isRecord(item) && item.transformationId === transformId);
    if (matches.length === 0) return { status: "missing", records: [] };
    return {
        status: matches.length > 1 ? "ambiguous" : "present",
        records: matches.map((item) => ({
            claimVerifications: item.claimVerifications ?? [],
            sourceSupport: item.sourceSupport ?? [],
            rightsAssessments: item.rightsAssessments ?? [],
            useApprovals: item.useApprovals ?? [],
            disposition: item.disposition ?? { status: "active" }
        }))
    };
}

function dimensionBlockers(readinessItem, decisions, migrationStatus, readinessCriteria = {}) {
    const blockers = {
        mapping: [],
        structure: [],
        adapterCompatibility: [],
        claimVerification: [],
        sourceSupport: [],
        rightsAssessment: [],
        useApproval: [],
        disposition: [],
        legacyParity: []
    };
    if (!readinessItem) {
        blockers.claimVerification.push("No review decision record is available for this transformation.");
        blockers.sourceSupport.push("No source-support decisions or evidence locators are available.");
        blockers.rightsAssessment.push("No rights assessments are available.");
        blockers.useApproval.push("No use-specific approval is available.");
        return blockers;
    }
    if (readinessItem.structuralValidity.status !== "valid") blockers.structure.push(...readinessItem.structuralValidity.errors);
    if (readinessItem.adapterCompatibility.status !== "compatible") blockers.adapterCompatibility.push(...readinessItem.adapterCompatibility.errors, `Adapter status: ${readinessItem.adapterCompatibility.status}.`);
    for (const claim of readinessItem.claimVerification) if (claim.status !== "verified") blockers.claimVerification.push(`${claim.claimId}: ${claim.status}.`);
    for (const support of readinessItem.sourceSupport) if (support.status !== "supports") blockers.sourceSupport.push(`${support.claimId} / ${support.sourceId}: ${support.status}.`);
    const allowedRights = readinessCriteria.allowedRightsStatuses ?? ["permitted", "public-domain"];
    for (const right of readinessItem.rightsAssessment) if (!allowedRights.includes(right.status)) blockers.rightsAssessment.push(`${right.sourceId}: ${right.status}.`);
    if (readinessItem.useApproval.status !== "approved") blockers.useApproval.push(`Intended use ${readinessItem.useApproval.intendedUse ?? "<unspecified>"}: ${readinessItem.useApproval.status}.`);
    if (["rejected", "withdrawn"].includes(readinessItem.disposition.status)) blockers.disposition.push(`Transformation is ${readinessItem.disposition.status}${readinessItem.disposition.reason ? `: ${readinessItem.disposition.reason}` : ""}.`);
    if (migrationStatus !== "match") blockers.legacyParity.push(`Legacy parity: ${migrationStatus}.`);
    for (const decision of decisions.records.flatMap((item) => Array.isArray(item.sourceSupport) ? item.sourceSupport : [])) {
        if (decision.status !== "unchecked" && !decision.evidenceLocator) blockers.sourceSupport.push(`${decision.claimId} / ${decision.sourceId}: evidence locator is missing.`);
    }
    for (const decision of decisions.records.flatMap((item) => Array.isArray(item.claimVerifications) ? item.claimVerifications : [])) {
        if (["verified", "disputed"].includes(decision.status) && !decision.evidenceLocator) blockers.claimVerification.push(`${decision.claimId}: evidence locator is missing.`);
    }
    return Object.fromEntries(Object.entries(blockers).map(([key, values]) => [key, [...new Set(values)].sort()]));
}

function generateReviewPacket(candidateManifest, options = {}) {
    const candidateValidation = readCandidateManifest(candidateManifest);
    const sourceReviewProvided = Object.hasOwn(options, "sourceReviewFindings");
    const sourceReviewValidation = sourceReviewProvided
        ? validateSourceReviewFindings(options.sourceReviewFindings, candidateManifest)
        : null;
    const { libraries, errors: libraryErrors } = options.libraries
        ? { libraries: options.libraries, errors: [] }
        : loadLegacyLibraries(options.contentDirectories);
    const canonical = options.canonicalContent;
    const canonicalValidation = canonical ? validateCanonicalContent(canonical) : null;
    const migrationValidation = options.migrationManifest && canonical
        ? validateMigrationManifest(options.migrationManifest, canonical, { contentDirectories: options.contentDirectories ?? LEGACY_CONTENT_DIRECTORIES })
        : null;
    const readiness = options.reviewManifest && canonical
        ? evaluateReadiness(options.reviewManifest, canonical, {
            intendedUse: options.intendedUse,
            criteria: options.readinessCriteria,
            migrationManifest: options.migrationManifest,
            migrationOptions: { contentDirectories: options.contentDirectories ?? LEGACY_CONTENT_DIRECTORIES }
        })
        : null;
    const transformsById = new Map((Array.isArray(canonical?.transformations) ? canonical.transformations : []).filter(isRecord).map((record) => [record.id, record]));
    const claimById = new Map((Array.isArray(canonical?.claims) ? canonical.claims : []).filter(isRecord).map((record) => [record.id, record]));

    const items = candidateValidation.items.map((candidate) => {
        const legacy = resolveLegacyCandidate(candidate, libraries);
        const matchedMappings = (options.migrationManifest?.entries ?? []).filter((entry) => mappingMatches(entry, candidate));
        let mapping;
        if (matchedMappings.length === 0) mapping = { status: "unmapped", transformationId: null, errors: ["No explicit migration-manifest entry maps this legacy identity to a canonical transformation."] };
        else if (matchedMappings.length > 1) mapping = { status: "ambiguous", transformationId: null, errors: [`${matchedMappings.length} migration entries match this legacy identity.`] };
        else if (!isRecord(matchedMappings[0]) || typeof matchedMappings[0].transformationId !== "string") mapping = { status: "invalid", transformationId: null, errors: ["The matching migration entry has no valid transformationId."] };
        else if (!canonical) mapping = { status: "unresolved", transformationId: matchedMappings[0].transformationId, errors: ["Canonical content was not supplied, so the transformation reference cannot be resolved."] };
        else if (!transformsById.has(matchedMappings[0].transformationId)) mapping = { status: "unresolved", transformationId: matchedMappings[0].transformationId, errors: [`Canonical transformation ${matchedMappings[0].transformationId} does not exist in the supplied document.`] };
        else mapping = { status: "mapped", transformationId: matchedMappings[0].transformationId, errors: [] };

        const transformation = mapping.status === "mapped" ? transformsById.get(mapping.transformationId) : null;
        const context = transformation && canonicalValidation?.valid ? findCanonicalContext(transformation, canonical) : { claims: [], entities: [], sources: [] };
        const sourcePairs = (transformation?.claimIds ?? []).flatMap((claimId) =>
            (claimById.get(claimId)?.sourceIds ?? []).map((sourceId) => ({ claimId, sourceId }))
        );
        const multiClaim = Boolean(transformation && transformation.claimIds?.length !== 1);
        let adapterCompatibility = { status: "not-checked", errors: [] };
        if (transformation && canonicalValidation?.valid) {
            try {
                adaptFactOrCap(canonical, transformation.id);
                adapterCompatibility = { status: "compatible", errors: [] };
            } catch (error) {
                adapterCompatibility = { status: "incompatible", errors: [error.message] };
            }
        } else if (transformation) {
            adapterCompatibility = { status: "canonical-invalid", errors: canonicalValidation.errors };
        }
        const migrationEntry = migrationValidation?.entries?.find(({ mapping: sourceMapping }) => mappingMatches(sourceMapping, candidate));
        const legacyParity = migrationEntry
            ? { status: !migrationEntry.valid ? "invalid" : migrationEntry.matches ? "match" : "mismatch", differences: migrationEntry.differences, errors: migrationEntry.errors }
            : {
                status: options.migrationManifest
                    ? mapping.status === "ambiguous" ? "ambiguous-mapping" : mapping.status === "unmapped" ? "unmapped" : "unresolved"
                    : "not-checked",
                differences: [],
                errors: []
            };
        const decisions = transformation && options.reviewManifest
            ? decisionSnapshot(options.reviewManifest, transformation.id)
            : { status: "missing", records: [] };
        const readinessItem = readiness?.items.find((item) => item.transformationId === transformation?.id);
        const blockers = dimensionBlockers(readinessItem, decisions, legacyParity.status, options.readinessCriteria);
        if (mapping.status !== "mapped") blockers.mapping.push(...mapping.errors);
        if (legacyParity.status !== "match" && legacyParity.status !== "not-checked") blockers.legacyParity.push(`Legacy parity: ${legacyParity.status}.`);
        if (legacy.status !== "resolved") blockers.structure.push(...legacy.errors);
        if (!canonical) blockers.structure.push("Canonical content was not supplied; no transformation/claim/source context can be resolved.");
        else if (!canonicalValidation.valid) blockers.structure.push(...canonicalValidation.errors);
        if (transformation && multiClaim && adapterCompatibility.status !== "compatible") blockers.adapterCompatibility.push("Fact-or-Cap adapter currently requires exactly one linked claim per transformation.");
        if (!options.reviewManifest) {
            blockers.claimVerification.push("No review-decision manifest was supplied.");
            blockers.sourceSupport.push("No review-decision manifest was supplied; source support and evidence locators are absent.");
            blockers.rightsAssessment.push("No review-decision manifest was supplied.");
            blockers.useApproval.push("No review-decision manifest was supplied.");
        } else if (!transformation) {
            blockers.claimVerification.push("Canonical transformation is unresolved, so claim decisions cannot be attached.");
            blockers.sourceSupport.push("Canonical transformation is unresolved, so source-support decisions cannot be attached.");
            blockers.rightsAssessment.push("Canonical transformation is unresolved, so rights decisions cannot be attached.");
            blockers.useApproval.push("Canonical transformation is unresolved, so use approval cannot be attached.");
        } else if (decisions.status === "missing") {
            blockers.claimVerification.push("No review item exists for this transformation.");
            blockers.sourceSupport.push("No review item exists for this transformation; source-support decisions and evidence locators are absent.");
            blockers.rightsAssessment.push("No review item exists for this transformation.");
            blockers.useApproval.push("No review item exists for this transformation.");
        } else if (decisions.status === "ambiguous") {
            blockers.structure.push("More than one review item references this transformation.");
        }
        const sourceMetadata = legacy.question ? {
            sourceName: legacy.question.sourceName ?? null,
            sourceUrl: legacy.question.sourceUrl ?? null,
            origin: "legacy question pack; attribution only, not reviewed evidence"
        } : null;
        return {
            legacyIdentity: { gameId: candidate.gameId, contentPackId: candidate.contentPackId, questionId: candidate.questionId },
            reviewFocus: candidate.reviewFocus ?? null,
            legacyQuestion: legacy.question ? {
                packFile: legacy.packFile,
                prompt: legacy.question.text,
                completion: legacy.question.correctCompletion,
                category: legacy.question.category ?? null,
                tags: legacy.question.tags ?? [],
                difficulty: legacy.question.difficulty ?? null
            } : { status: legacy.status, errors: legacy.errors },
            repositorySourceMetadata: sourceMetadata,
            sourceReviewObservations: sourceReviewSnapshot(candidate, sourceReviewValidation, sourceReviewProvided),
            mapping,
            canonical: {
                validation: canonical ? (canonicalValidation.valid ? "valid" : "invalid") : "not-provided",
                transformation: transformation ? { id: transformation.id, gameFormatId: transformation.gameFormatId, claimIds: transformation.claimIds, entityIds: transformation.entityIds } : null,
                claims: context.claims,
                entities: context.entities,
                sources: context.sources,
                sourceClaimLinks: sourcePairs
            },
            reviewDecisions: decisions,
            adapterCompatibility,
            legacyParity,
            readiness: readinessItem ? { ready: readinessItem.ready, reasons: readinessItem.reasons } : { status: "not-assessed" },
            blockersByDimension: Object.fromEntries(Object.entries(blockers).map(([key, values]) => [key, [...new Set(values)].sort()]))
        };
    });
    const mappedCount = items.filter(({ mapping: itemMapping }) => itemMapping.status === "mapped").length;
    return {
        schemaVersion: REVIEW_PACKET_VERSION,
        purpose: "Offline editorial review packet; not an approval or publication decision.",
        candidatePlan: { valid: candidateValidation.valid, errors: candidateValidation.errors },
        inputs: {
            canonical: canonical ? (canonicalValidation.valid ? "structurally-valid" : "structurally-invalid") : "not-provided",
            migrationManifest: options.migrationManifest ? (migrationValidation?.valid ? "valid" : "invalid") : "not-provided",
            reviewManifest: options.reviewManifest ? (readiness?.structuralValidity.status === "valid" ? "structurally-valid" : "structurally-invalid") : "not-provided",
            intendedUse: options.intendedUse ?? null,
            sourceReviewFindings: !sourceReviewProvided
                ? "not-provided"
                : sourceReviewValidation.valid ? "valid" : "invalid"
        },
        sourceReviewFindings: sourceReviewProvided
            ? {
                schemaVersion: options.sourceReviewFindings?.schemaVersion ?? null,
                valid: sourceReviewValidation.valid,
                errors: sourceReviewValidation.errors,
                unmatchedItems: sourceReviewValidation.unmatchedItems,
                effectOnFormalDecisions: "none",
                effectOnReadiness: "none"
            }
            : { status: "not-provided", effectOnFormalDecisions: "none", effectOnReadiness: "none" },
        libraryErrors,
        summary: {
            candidateCount: items.length,
            legacyResolved: items.filter(({ legacyQuestion }) => legacyQuestion.prompt !== undefined).length,
            explicitlyMapped: mappedCount,
            readyForIntendedUse: items.filter(({ readiness: result }) => result.ready === true).length
        },
        items
    };
}

module.exports = { REVIEW_PACKET_VERSION, generateReviewPacket, loadLegacyLibraries, readCandidateManifest };
