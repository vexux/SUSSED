const { validateCanonicalContent } = require("./canonicalContent");
const { adaptFactOrCap } = require("./factOrCapAdapter");
const { validateMigrationManifest } = require("./migrationManifest");

const REVIEW_DECISION_VERSION = 1;
const MANIFEST_FIELDS = new Set(["schemaVersion", "items"]);
const ITEM_FIELDS = new Set([
    "transformationId",
    "claimVerifications",
    "sourceSupport",
    "rightsAssessments",
    "useApprovals",
    "disposition"
]);
const CANONICAL_ID = /^(entity|claim|source|transform):[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VERIFICATION_STATUSES = new Set(["unverified", "verified", "disputed"]);
const SUPPORT_STATUSES = new Set(["unchecked", "supports", "contradicts", "insufficient"]);
const RIGHTS_STATUSES = new Set(["unknown", "permitted", "restricted", "public-domain", "permission-required"]);
const APPROVAL_STATUSES = new Set(["pending", "approved", "rejected"]);
const DISPOSITION_STATUSES = new Set(["active", "rejected", "withdrawn"]);
const DEFAULT_ALLOWED_RIGHTS = Object.freeze(["permitted", "public-domain"]);

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
    return typeof value === "string" && value.trim() !== "";
}

function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function indexById(records) {
    return new Map(records.map((record) => [record.id, record]));
}

function findDecision(decisions, predicate) {
    return Array.isArray(decisions)
        ? decisions.find((decision) => isRecord(decision) && predicate(decision))
        : undefined;
}

function validateDecisionManifest(manifest, canonical, fileName = "<review-manifest>") {
    const errors = [];
    const fail = (where, message) => errors.push(`${fileName}: ${where} ${message}`);
    if (!isRecord(manifest)) return { valid: false, errors: [`${fileName}: expected an object.`] };
    for (const field of Object.keys(manifest)) {
        if (!MANIFEST_FIELDS.has(field)) fail(field, "is not a supported field.");
    }
    if (manifest.schemaVersion !== REVIEW_DECISION_VERSION) {
        fail("schemaVersion", `must be the supported version ${REVIEW_DECISION_VERSION}.`);
    }
    if (!Array.isArray(manifest.items)) {
        fail("items", "must be an array.");
        return { valid: false, errors };
    }
    const canonicalResult = validateCanonicalContent(canonical);
    if (!canonicalResult.valid) errors.push(...canonicalResult.errors.map((error) => `Canonical content: ${error}`));

    const collection = (name) => Array.isArray(canonical?.[name]) ? canonical[name] : [];
    const claims = new Map(collection("claims").filter(isRecord).map((record) => [record.id, record]));
    const sources = new Map(collection("sources").filter(isRecord).map((record) => [record.id, record]));
    const transformations = new Map(collection("transformations").filter(isRecord).map((record) => [record.id, record]));
    const seenTransforms = new Set();
    const requireDecisionFields = (decision, label, { evidence = false, basis = false } = {}) => {
        for (const field of ["reviewerId", "decidedAt", "rationale"]) {
            if (!nonEmpty(decision[field])) fail(`${label}.${field}`, "is required and must be a non-empty string.");
        }
        if (nonEmpty(decision.decidedAt) && !validDate(decision.decidedAt)) fail(`${label}.decidedAt`, "must be an ISO calendar date.");
        if (evidence && !nonEmpty(decision.evidenceLocator)) fail(`${label}.evidenceLocator`, "is required for this decision.");
        if (basis && !nonEmpty(decision.rightsBasis)) fail(`${label}.rightsBasis`, "is required for a determined rights outcome.");
    };
    const validateDecisionArray = (item, key, label, allowed, referenceFields, optionsForDecision = () => ({})) => {
        if (!Array.isArray(item[key])) {
            fail(`${label}.${key}`, "must be an array (use an empty array when no decision has been recorded).");
            return [];
        }
        const seen = new Set();
        item[key].forEach((decision, decisionIndex) => {
            const decisionLabel = `${label}.${key}[${decisionIndex}]`;
            if (!isRecord(decision)) {
                fail(decisionLabel, "must be an object.");
                return;
            }
            const identity = referenceFields.map((field) => decision[field]).join("\0");
            if (referenceFields.some((field) => !nonEmpty(decision[field]))) {
                for (const field of referenceFields) if (!nonEmpty(decision[field])) fail(`${decisionLabel}.${field}`, "is required.");
            }
            if (seen.has(identity)) fail(decisionLabel, "duplicates a decision reference in this array.");
            seen.add(identity);
            for (const field of Object.keys(decision)) {
                if (![...referenceFields, "status", "reviewerId", "decidedAt", "rationale", "evidenceLocator", "rightsBasis", "conditions"].includes(field)) {
                    fail(`${decisionLabel}.${field}`, "is not a supported field.");
                }
            }
            if (!allowed.has(decision.status)) fail(`${decisionLabel}.status`, `has unsupported value ${JSON.stringify(decision.status)}.`);
            const options = optionsForDecision(decision);
            requireDecisionFields(decision, decisionLabel, options);
            if (decision.evidenceLocator !== undefined && decision.evidenceLocator !== null && !nonEmpty(decision.evidenceLocator)) {
                fail(`${decisionLabel}.evidenceLocator`, "must be a non-empty string when supplied.");
            }
            if (decision.rightsBasis !== undefined && decision.rightsBasis !== null && !nonEmpty(decision.rightsBasis)) {
                fail(`${decisionLabel}.rightsBasis`, "must be a non-empty string when supplied.");
            }
            if (decision.conditions !== undefined && (!Array.isArray(decision.conditions) || decision.conditions.some((entry) => !nonEmpty(entry)))) {
                fail(`${decisionLabel}.conditions`, "must be an array of non-empty strings when supplied.");
            }
        });
        return item[key];
    };

    manifest.items.forEach((item, itemIndex) => {
        const label = `items[${itemIndex}]`;
        if (!isRecord(item)) {
            fail(label, "must be an object.");
            return;
        }
        for (const field of Object.keys(item)) if (!ITEM_FIELDS.has(field)) fail(`${label}.${field}`, "is not a supported field.");
        if (!nonEmpty(item.transformationId) || !CANONICAL_ID.test(item.transformationId)) {
            fail(`${label}.transformationId`, "must be a valid transform: ID.");
        }
        if (seenTransforms.has(item.transformationId)) fail(`${label}.transformationId`, "duplicates an item already in the manifest.");
        seenTransforms.add(item.transformationId);
        const transformation = transformations.get(item.transformationId);
        if (!transformation) fail(`${label}.transformationId`, `references unknown transformation ${JSON.stringify(item.transformationId)}.`);

        const claimVerifications = validateDecisionArray(item, "claimVerifications", label, VERIFICATION_STATUSES, ["claimId"], (decision) => ({
            evidence: ["verified", "disputed"].includes(decision.status)
        }));
        const sourceSupport = validateDecisionArray(item, "sourceSupport", label, SUPPORT_STATUSES, ["claimId", "sourceId"], (decision) => ({
            evidence: decision.status !== "unchecked"
        }));
        const rightsAssessments = validateDecisionArray(item, "rightsAssessments", label, RIGHTS_STATUSES, ["sourceId"], (decision) => ({
            basis: decision.status !== "unknown"
        }));
        const useApprovals = validateDecisionArray(item, "useApprovals", label, APPROVAL_STATUSES, ["intendedUse"], () => ({}));

        const linkedClaimIds = new Set(transformation?.claimIds ?? []);
        const linkedSourcePairs = new Set();
        for (const claimId of linkedClaimIds) {
            for (const sourceId of claims.get(claimId)?.sourceIds ?? []) linkedSourcePairs.add(`${claimId}\0${sourceId}`);
        }
        for (const [field, decisions, referenceFields, allowedRefs] of [
            ["claimVerifications", claimVerifications, ["claimId"], linkedClaimIds],
            ["sourceSupport", sourceSupport, ["claimId", "sourceId"], linkedSourcePairs]
        ]) {
            decisions.forEach((decision, decisionIndex) => {
                if (!isRecord(decision)) return;
                const key = referenceFields.map((referenceField) => decision[referenceField]).join("\0");
                if (!allowedRefs.has(key)) fail(`${label}.${field}[${decisionIndex}]`, "references a claim/source relationship not used by this transformation.");
            });
        }
        rightsAssessments.forEach((decision, decisionIndex) => {
            if (isRecord(decision) && ![...linkedSourcePairs].some((pair) => pair.endsWith(`\0${decision.sourceId}`))) {
                fail(`${label}.rightsAssessments[${decisionIndex}].sourceId`, "is not a source used by this transformation.");
            }
        });
        if (item.disposition !== undefined) {
            const d = item.disposition;
            if (!isRecord(d)) {
                fail(`${label}.disposition`, "must be an object when supplied.");
            } else {
                for (const field of Object.keys(d)) if (!["status", "reason", "decidedAt", "reviewerId"].includes(field)) fail(`${label}.disposition.${field}`, "is not a supported field.");
                if (!DISPOSITION_STATUSES.has(d.status)) fail(`${label}.disposition.status`, `has unsupported value ${JSON.stringify(d.status)}.`);
                if (d.status !== "active") {
                    for (const field of ["reason", "reviewerId", "decidedAt"]) if (!nonEmpty(d[field])) fail(`${label}.disposition.${field}`, "is required for rejection or withdrawal.");
                    if (nonEmpty(d.decidedAt) && !validDate(d.decidedAt)) fail(`${label}.disposition.decidedAt`, "must be an ISO calendar date.");
                }
            }
        }
    });
    return { valid: errors.length === 0, errors };
}

function evaluateReadiness(manifest, canonical, options = {}) {
    const intendedUse = options.intendedUse;
    const criteria = {
        allowedRightsStatuses: options.criteria?.allowedRightsStatuses ?? DEFAULT_ALLOWED_RIGHTS,
        requireLegacyParity: options.criteria?.requireLegacyParity === true
    };
    const invalidRights = !Array.isArray(criteria.allowedRightsStatuses) ||
        criteria.allowedRightsStatuses.some((status) => !RIGHTS_STATUSES.has(status) || status === "unknown");
    const structure = validateDecisionManifest(manifest, canonical, options.fileName);
    const canonicalStructure = validateCanonicalContent(canonical);
    const migrationResult = options.migrationManifest
        ? validateMigrationManifest(options.migrationManifest, canonical, options.migrationOptions)
        : null;
    const canonicalCollection = (name) => Array.isArray(canonical?.[name]) ? canonical[name] : [];
    const claimsById = indexById(canonicalCollection("claims").filter(isRecord));
    const sourcesById = indexById(canonicalCollection("sources").filter(isRecord));
    const transformationsById = indexById(canonicalCollection("transformations").filter(isRecord));
    const manifestItems = Array.isArray(manifest?.items) ? manifest.items : [];
    const allowedRights = Array.isArray(criteria.allowedRightsStatuses) ? criteria.allowedRightsStatuses : [];
    const items = manifestItems.map((item) => {
        const reviewItem = isRecord(item) ? item : {};
        const transformation = transformationsById.get(reviewItem.transformationId);
        const reasons = [];
        if (!structure.valid) reasons.push("Review decision manifest failed structural validation.");
        if (invalidRights) reasons.push("Configured allowedRightsStatuses must contain only reviewed rights outcomes.");
        const linkedClaimIds = Array.isArray(transformation?.claimIds) ? transformation.claimIds : [];
        const claimResults = linkedClaimIds.map((claimId) => {
            const decision = findDecision(reviewItem.claimVerifications, (entry) => entry.claimId === claimId);
            const status = decision?.status ?? "missing";
            if (status !== "verified") reasons.push(status === "missing"
                ? `Claim ${claimId} has no verification decision.`
                : `Claim ${claimId} is ${status}; verified is required.`);
            return { claimId, status, reviewerId: decision?.reviewerId ?? null, decidedAt: decision?.decidedAt ?? null };
        });
        const supportResults = [];
        for (const claimId of linkedClaimIds) {
            const claimSourceIds = Array.isArray(claimsById.get(claimId)?.sourceIds) ? claimsById.get(claimId).sourceIds : [];
            for (const sourceId of claimSourceIds) {
                const decision = findDecision(reviewItem.sourceSupport, (entry) => entry.claimId === claimId && entry.sourceId === sourceId);
                const status = decision?.status ?? "missing";
                if (status !== "supports") reasons.push(status === "missing"
                    ? `Source ${sourceId} has no support decision for claim ${claimId}.`
                    : `Source ${sourceId} is marked ${status} for claim ${claimId}; supports is required.`);
                supportResults.push({ claimId, sourceId, status, evidenceLocator: decision?.evidenceLocator ?? null });
            }
        }
        const sourceIds = [...new Set(supportResults.map(({ sourceId }) => sourceId))].sort();
        const rightsResults = sourceIds.map((sourceId) => {
            const decision = findDecision(reviewItem.rightsAssessments, (entry) => entry.sourceId === sourceId);
            const status = decision?.status ?? "missing";
            if (status === "unknown" || status === "missing") reasons.push(status === "unknown"
                ? `Rights for source ${sourceId} are unknown.`
                : `Source ${sourceId} has no rights assessment.`);
            else if (!allowedRights.includes(status)) reasons.push(`Rights status ${status} for source ${sourceId} is not allowed by the configured criteria.`);
            return { sourceId, status, reviewerId: decision?.reviewerId ?? null, decidedAt: decision?.decidedAt ?? null, rightsBasis: decision?.rightsBasis ?? null };
        });
        const approval = findDecision(reviewItem.useApprovals, (entry) => entry.intendedUse === intendedUse);
        if (!intendedUse) reasons.push("No intended use was specified for this readiness report.");
        if (!approval) reasons.push(`No approval is recorded for intended use ${JSON.stringify(intendedUse ?? "<unspecified>")}.`);
        else if (approval.status !== "approved") reasons.push(`Approval for intended use ${JSON.stringify(intendedUse)} is ${approval.status}; approved is required.`);
        const disposition = reviewItem.disposition?.status ?? "active";
        if (disposition === "rejected" || disposition === "withdrawn") reasons.push(`Transformation is ${disposition}: ${reviewItem.disposition.reason}.`);
        const canonicalRecordReview = {
            transformationStatus: transformation?.reviewStatus ?? "missing",
            claimStatuses: linkedClaimIds.map((claimId) => ({
                claimId,
                status: claimsById.get(claimId)?.reviewStatus ?? "missing"
            })),
            sourceStatuses: sourceIds.map((sourceId) => ({
                sourceId,
                status: sourcesById.get(sourceId)?.reviewStatus ?? "missing"
            }))
        };
        const rejectedCanonicalRecords = [
            ...(canonicalRecordReview.transformationStatus === "rejected" ? [`transformation ${reviewItem.transformationId}`] : []),
            ...canonicalRecordReview.claimStatuses.filter(({ status }) => status === "rejected").map(({ claimId }) => `claim ${claimId}`),
            ...canonicalRecordReview.sourceStatuses.filter(({ status }) => status === "rejected").map(({ sourceId }) => `source ${sourceId}`)
        ];
        if (rejectedCanonicalRecords.length > 0) reasons.push(`Canonical records marked rejected cannot be ready: ${rejectedCanonicalRecords.join(", ")}.`);
        if (!canonicalStructure.valid) reasons.push("Canonical content failed structural validation.");
        let adapterCompatibility = { status: "not-checked", errors: [] };
        if (transformation) {
            try {
                adaptFactOrCap(canonical, transformation.id);
                adapterCompatibility = { status: "compatible", errors: [] };
            } catch (error) {
                adapterCompatibility = { status: "incompatible", errors: [error.message] };
                reasons.push(`Fact-or-Cap adapter compatibility failed: ${error.message}`);
            }
        } else {
            adapterCompatibility = { status: "missing-transformation", errors: [] };
            reasons.push(`Transformation ${item?.transformationId ?? "<missing>"} cannot be resolved.`);
        }
        let legacyParity = { status: "not-checked", differences: [], errors: [] };
        if (migrationResult) {
            const mappingResult = migrationResult.entries.find(({ mapping }) => mapping?.transformationId === reviewItem.transformationId);
            if (mappingResult) legacyParity = {
                status: !mappingResult.valid ? "invalid" : mappingResult.matches ? "match" : "mismatch",
                differences: mappingResult.differences,
                errors: mappingResult.errors
            };
            else legacyParity = { status: "not-mapped", differences: [], errors: [] };
        }
        if (criteria.requireLegacyParity && legacyParity.status !== "match") reasons.push(`Legacy parity is ${legacyParity.status}; a match is required by the configured criteria.`);
        return {
            transformationId: reviewItem.transformationId ?? null,
            structuralValidity: { status: structure.valid ? "valid" : "invalid", errors: structure.errors },
            adapterCompatibility,
            legacyParity,
            claimVerification: claimResults,
            sourceSupport: supportResults,
            rightsAssessment: rightsResults,
            useApproval: { intendedUse: intendedUse ?? null, status: approval?.status ?? "missing", conditions: approval?.conditions ?? [] },
            disposition: { status: disposition, ...(reviewItem.disposition?.reason ? { reason: reviewItem.disposition.reason } : {}) },
            canonicalRecordReview,
            ready: reasons.length === 0,
            reasons: [...new Set(reasons)].sort()
        };
    }).sort((a, b) => String(a.transformationId).localeCompare(String(b.transformationId)));
    return {
        schemaVersion: REVIEW_DECISION_VERSION,
        intendedUse: intendedUse ?? null,
        criteria: { allowedRightsStatuses: Array.isArray(criteria.allowedRightsStatuses) ? [...criteria.allowedRightsStatuses].sort() : [], requireLegacyParity: criteria.requireLegacyParity },
        structuralValidity: { status: structure.valid ? "valid" : "invalid", errors: structure.errors },
        migrationManifest: migrationResult ? { valid: migrationResult.valid, matches: migrationResult.matches, errors: migrationResult.errors } : { status: "not-checked" },
        ready: structure.valid && items.length > 0 && items.every((item) => item.ready),
        items
    };
}

module.exports = {
    DEFAULT_ALLOWED_RIGHTS,
    REVIEW_DECISION_VERSION,
    evaluateReadiness,
    validateDecisionManifest
};
