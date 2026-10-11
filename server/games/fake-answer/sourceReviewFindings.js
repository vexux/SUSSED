const SOURCE_REVIEW_FINDINGS_VERSION = 1;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const OUTCOMES = new Set(["observed", "insufficient", "inaccessible"]);

const TASK_10_IDENTITIES = [
    { gameId: "fact-or-cap", contentPackId: "general-facts-batch-2026-10", questionId: "saturn-ring-material" },
    { gameId: "fact-or-cap", contentPackId: "wildlife", questionId: "octopus-hearts" },
    { gameId: "fact-or-cap-anime", contentPackId: "anime-facts-batch-2026-10", questionId: "spy-family-anya-ability" }
];

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function identityKey(identity) {
    return [identity.gameId, identity.contentPackId, identity.questionId].join("\0");
}

function validateIdentity(identity, label, errors) {
    if (!isRecord(identity)) {
        errors.push(`${label} must be an object with gameId, contentPackId, and questionId.`);
        return false;
    }
    let valid = true;
    for (const field of ["gameId", "contentPackId", "questionId"]) {
        if (typeof identity[field] !== "string" || !ID_PATTERN.test(identity[field])) {
            errors.push(`${label}.${field} must be a stable lowercase ID.`);
            valid = false;
        }
    }
    for (const field of Object.keys(identity)) {
        if (!["gameId", "contentPackId", "questionId"].includes(field)) {
            errors.push(`${label}.${field} is not a supported identity field.`);
            valid = false;
        }
    }
    return valid;
}

function validateObservation(observation, label) {
    const errors = [];
    if (!isRecord(observation)) return [`${label} must be an object.`];
    const required = [
        "findingId", "claimOrWording", "sourceTitle", "sourceUrl", "evidenceLocator",
        "observedFinding", "inspectionOutcome", "unresolvedFollowUp"
    ];
    for (const field of required) {
        if (!Object.hasOwn(observation, field)) errors.push(`${label}.${field} is required.`);
    }
    for (const field of Object.keys(observation)) {
        if (!required.includes(field)) errors.push(`${label}.${field} is not a supported observation field.`);
    }
    if (typeof observation.findingId !== "string" || !ID_PATTERN.test(observation.findingId)) {
        errors.push(`${label}.findingId must be a stable lowercase ID.`);
    }
    for (const field of ["claimOrWording", "sourceTitle", "observedFinding"]) {
        if (!nonEmpty(observation[field])) errors.push(`${label}.${field} must be a non-empty string.`);
    }
    if (typeof observation.sourceUrl !== "string") {
        errors.push(`${label}.sourceUrl must be an HTTP or HTTPS URL.`);
    } else {
        try {
            const url = new URL(observation.sourceUrl);
            if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
        } catch {
            errors.push(`${label}.sourceUrl must be an HTTP or HTTPS URL.`);
        }
    }
    if (!OUTCOMES.has(observation.inspectionOutcome)) {
        errors.push(`${label}.inspectionOutcome must be observed, insufficient, or inaccessible.`);
    }
    if (observation.evidenceLocator !== null && !nonEmpty(observation.evidenceLocator)) {
        errors.push(`${label}.evidenceLocator must be a non-empty string or null.`);
    }
    if (observation.inspectionOutcome === "observed" && !nonEmpty(observation.evidenceLocator)) {
        errors.push(`${label}.evidenceLocator is required when inspectionOutcome is observed.`);
    }
    if (observation.inspectionOutcome === "inaccessible" && observation.evidenceLocator !== null) {
        errors.push(`${label}.evidenceLocator must be null when the source is inaccessible.`);
    }
    if (!Array.isArray(observation.unresolvedFollowUp) || observation.unresolvedFollowUp.length === 0) {
        errors.push(`${label}.unresolvedFollowUp must be a non-empty array of follow-up items.`);
    } else {
        observation.unresolvedFollowUp.forEach((followUp, index) => {
            if (!nonEmpty(followUp)) errors.push(`${label}.unresolvedFollowUp[${index}] must be a non-empty string.`);
        });
    }
    return errors;
}

function validateSourceReviewFindings(manifest, candidateManifest) {
    const errors = [];
    const unmatchedItems = [];
    const byIdentity = new Map();
    const planItems = (Array.isArray(candidateManifest?.items) ? candidateManifest.items : [])
        .filter(isRecord)
        .map(identityKey);
    const planCounts = new Map();
    for (const key of planItems) planCounts.set(key, (planCounts.get(key) ?? 0) + 1);
    const inPlan = new Set(planCounts.keys());
    const ambiguousPlanIdentities = new Set([...planCounts].filter(([, count]) => count > 1).map(([key]) => key));
    const allowed = new Set(TASK_10_IDENTITIES.map(identityKey));
    const expectedItems = new Map();

    if (!isRecord(manifest)) {
        return { valid: false, errors: ["Source-review findings must be an object."], byIdentity, unmatchedItems, ambiguousPlanIdentities, readable: false };
    }
    if (manifest.schemaVersion !== SOURCE_REVIEW_FINDINGS_VERSION) {
        errors.push(`Source-review findings schemaVersion must be ${SOURCE_REVIEW_FINDINGS_VERSION}.`);
    }
    const inspectionDate = manifest.inspectionDate;
    const parsedInspectionDate = typeof inspectionDate === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(inspectionDate)
        ? new Date(`${inspectionDate}T00:00:00Z`)
        : null;
    if (!parsedInspectionDate || Number.isNaN(parsedInspectionDate.getTime()) || parsedInspectionDate.toISOString().slice(0, 10) !== inspectionDate) {
        errors.push("Source-review findings inspectionDate must be an ISO calendar date.");
    }
    if (!Array.isArray(manifest.items)) {
        errors.push("Source-review findings items must be an array.");
        return { valid: false, errors, byIdentity, unmatchedItems, ambiguousPlanIdentities, readable: false };
    }
    for (const field of Object.keys(manifest)) {
        if (!["schemaVersion", "inspectionDate", "items"].includes(field)) {
            errors.push(`${field} is not a supported source-review findings field.`);
        }
    }
    for (const identity of TASK_10_IDENTITIES) {
        expectedItems.set(identityKey(identity), identity);
        if (!inPlan.has(identityKey(identity))) {
            errors.push(`Candidate plan does not contain required Task 10 identity ${identity.gameId}/${identity.contentPackId}/${identity.questionId}.`);
        }
        if (ambiguousPlanIdentities.has(identityKey(identity))) {
            errors.push(`Candidate plan contains an ambiguous duplicate Task 10 identity ${identity.gameId}/${identity.contentPackId}/${identity.questionId}.`);
        }
    }

    manifest.items.forEach((item, index) => {
        const label = `items[${index}]`;
        if (!isRecord(item)) {
            errors.push(`${label} must be an object.`);
            unmatchedItems.push({ index, status: "invalid", errors: [`${label} must be an object.`] });
            return;
        }
        const itemErrors = [];
        for (const field of Object.keys(item)) {
            if (!["candidate", "observations"].includes(field)) itemErrors.push(`${label}.${field} is not a supported item field.`);
        }
        const identityErrors = [];
        const validIdentity = validateIdentity(item.candidate, `${label}.candidate`, identityErrors);
        errors.push(...identityErrors);
        if (!validIdentity) {
            errors.push(...itemErrors);
            unmatchedItems.push({ index, candidate: item.candidate ?? null, status: "invalid", errors: [...identityErrors, ...itemErrors] });
            return;
        }
        const key = identityKey(item.candidate);
        if (!allowed.has(key)) {
            const issue = `Source-review finding identity ${item.candidate.gameId}/${item.candidate.contentPackId}/${item.candidate.questionId} is outside the Task 10 scope.`;
            errors.push(issue, ...itemErrors);
            unmatchedItems.push({ index, candidate: item.candidate, status: "unknown-candidate", errors: [issue, ...itemErrors] });
            return;
        }
        if (!inPlan.has(key)) {
            const issue = `Source-review identity ${item.candidate.gameId}/${item.candidate.contentPackId}/${item.candidate.questionId} is not present in the candidate plan.`;
            errors.push(issue, ...itemErrors);
            unmatchedItems.push({ index, candidate: item.candidate, status: "not-in-plan", errors: [issue, ...itemErrors] });
            return;
        }
        const matches = byIdentity.get(key) ?? [];
        if (!Array.isArray(item.observations) || item.observations.length === 0) {
            itemErrors.push(`${label}.observations must be a non-empty array.`);
        } else {
            item.observations.forEach((observation, observationIndex) => {
                itemErrors.push(...validateObservation(observation, `${label}.observations[${observationIndex}]`));
            });
        }
        errors.push(...itemErrors);
        matches.push({ item, index, errors: itemErrors });
        byIdentity.set(key, matches);
    });

    for (const [key, identity] of expectedItems) {
        const matches = byIdentity.get(key) ?? [];
        if (matches.length === 0) errors.push(`Missing source-review findings for ${identity.gameId}/${identity.contentPackId}/${identity.questionId}.`);
        if (matches.length > 1) errors.push(`Ambiguous source-review identity ${identity.gameId}/${identity.contentPackId}/${identity.questionId}: ${matches.length} entries match.`);
    }

    return { valid: errors.length === 0, errors, byIdentity, unmatchedItems, ambiguousPlanIdentities, readable: true };
}

module.exports = {
    SOURCE_REVIEW_FINDINGS_VERSION,
    TASK_10_IDENTITIES,
    validateSourceReviewFindings
};
