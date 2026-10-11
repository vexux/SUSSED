const ENTITY_KINDS = new Set([
    "franchise",
    "series",
    "character",
    "game",
    "person",
    "location",
    "organization",
    "concept",
    "other",
]);
const REVIEW_STATUSES = new Set(["unreviewed", "flagged", "reviewed", "rejected"]);
const VERIFICATION_STATUSES = new Set(["unverified", "verified", "disputed"]);
const RIGHTS_STATUSES = new Set([
    "unknown",
    "permitted",
    "restricted",
    "public-domain",
    "permission-required",
]);
const ID_PATTERN = /^(entity|claim|source|transform):[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

function isCalendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        return false;
    }
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateCanonicalContent(data, fileName = "<input>") {
    const errors = [];
    const fail = (path, message) => errors.push(`${fileName}: ${path} ${message}`);
    if (!isRecord(data)) {
        return { valid: false, errors: [`${fileName}: expected an object.`] };
    }
    if (data.schemaVersion !== 1) {
        fail("schemaVersion", "must be the supported version 1.");
    }

    const collections = ["entities", "claims", "sources", "transformations"];
    for (const collection of collections) {
        if (!Array.isArray(data[collection])) {
            fail(collection, "must be an array.");
        }
    }
    if (collections.some((collection) => !Array.isArray(data[collection]))) {
        return { valid: errors.length === 0, errors };
    }

    const ids = new Map();
    const registerId = (entry, path, prefix) => {
        if (!isNonEmptyString(entry?.id)) {
            fail(`${path}.id`, "is required and must be a non-empty string.");
            return;
        }
        if (!ID_PATTERN.test(entry.id)) {
            fail(`${path}.id`, "must use a stable kind-prefixed lowercase ID.");
        } else if (entry.id.slice(0, entry.id.indexOf(":")) !== prefix) {
            fail(`${path}.id`, `must use the ${prefix}: ID prefix.`);
        }
        if (ids.has(entry.id)) {
            fail(`${path}.id`, `duplicates ${ids.get(entry.id)} (${entry.id}).`);
        } else {
            ids.set(entry.id, path);
        }
        if (entry.recordVersion !== 1) {
            fail(`${path}.recordVersion`, "must be the supported version 1.");
        }
    };
    const checkString = (entry, field, path) => {
        if (!isNonEmptyString(entry[field])) {
            fail(`${path}.${field}`, "is required and must be a non-empty string.");
        }
    };
    const checkStatus = (entry, field, allowed, path) => {
        if (!allowed.has(entry[field])) {
            fail(`${path}.${field}`, `has unsupported value ${JSON.stringify(entry[field])}.`);
        }
    };
    const checkIdList = (value, field, path) => {
        if (!Array.isArray(value) || value.length === 0 || value.some((id) => !isNonEmptyString(id))) {
            fail(`${path}.${field}`, "must be a non-empty array of IDs.");
        }
    };

    const entities = new Map();
    data.entities.forEach((entry, index) => {
        const path = `entities[${index}]`;
        if (!isRecord(entry)) {
            fail(path, "must be an object.");
            return;
        }
        registerId(entry, path, "entity");
        checkString(entry, "name", path);
        checkStatus(entry, "kind", ENTITY_KINDS, path);
        checkStatus(entry, "reviewStatus", REVIEW_STATUSES, path);
        if (isNonEmptyString(entry.id)) entities.set(entry.id, entry);
        if (entry.franchiseEntityId !== undefined && !isNonEmptyString(entry.franchiseEntityId)) {
            fail(`${path}.franchiseEntityId`, "must be a non-empty entity ID when supplied.");
        }
    });

    const sources = new Map();
    data.sources.forEach((entry, index) => {
        const path = `sources[${index}]`;
        if (!isRecord(entry)) {
            fail(path, "must be an object.");
            return;
        }
        registerId(entry, path, "source");
        checkString(entry, "title", path);
        checkString(entry, "url", path);
        checkStatus(entry, "reviewStatus", REVIEW_STATUSES, path);
        if (isNonEmptyString(entry.url)) {
            try {
                if (!["http:", "https:"].includes(new URL(entry.url).protocol)) {
                    fail(`${path}.url`, "must use HTTP or HTTPS.");
                }
            } catch {
                fail(`${path}.url`, "must be a valid HTTP or HTTPS URL.");
            }
        }
        if (entry.publisher !== undefined && entry.publisher !== null && !isNonEmptyString(entry.publisher)) {
            fail(`${path}.publisher`, "must be a non-empty string or null.");
        }
        if (entry.creator !== undefined && entry.creator !== null && !isNonEmptyString(entry.creator)) {
            fail(`${path}.creator`, "must be a non-empty string or null.");
        }
        if (!Object.hasOwn(entry, "accessedAt")) {
            fail(`${path}.accessedAt`, "is required; use null when the access date is unknown.");
        } else if (entry.accessedAt !== null && !isCalendarDate(entry.accessedAt)) {
            fail(`${path}.accessedAt`, "must be an ISO calendar date or null when unknown.");
        }
        if (!isRecord(entry.rightsReview)) {
            fail(`${path}.rightsReview`, "is required and must be an object.");
        } else {
            checkStatus(entry.rightsReview, "status", RIGHTS_STATUSES, `${path}.rightsReview`);
            if (!Object.hasOwn(entry.rightsReview, "license")) {
                fail(`${path}.rightsReview.license`, "is required; use null when unknown.");
            } else if (entry.rightsReview.license !== null &&
                !isNonEmptyString(entry.rightsReview.license)) {
                fail(`${path}.rightsReview.license`, "must be a non-empty string or null.");
            }
            if (!Object.hasOwn(entry.rightsReview, "reviewedAt")) {
                fail(`${path}.rightsReview.reviewedAt`, "is required; use null when not reviewed.");
            } else if (entry.rightsReview.reviewedAt !== null && !isCalendarDate(entry.rightsReview.reviewedAt)) {
                fail(`${path}.rightsReview.reviewedAt`, "must be an ISO calendar date or null.");
            }
            if (!Object.hasOwn(entry.rightsReview, "reviewerId")) {
                fail(`${path}.rightsReview.reviewerId`, "is required; use null when not reviewed.");
            } else if (entry.rightsReview.reviewerId !== null && !isNonEmptyString(entry.rightsReview.reviewerId)) {
                fail(`${path}.rightsReview.reviewerId`, "must be a non-empty string or null.");
            }
            if (["permitted", "public-domain"].includes(entry.rightsReview.status)) {
                if (!isNonEmptyString(entry.rightsReview.license)) {
                    fail(`${path}.rightsReview.license`, "must record the applicable license or basis for this rights status.");
                }
                if (!isCalendarDate(entry.rightsReview.reviewedAt) || !isNonEmptyString(entry.rightsReview.reviewerId)) {
                    fail(`${path}.rightsReview`, "permitted or public-domain status requires a review date and reviewer ID.");
                }
            }
        }
        if (isNonEmptyString(entry.id)) sources.set(entry.id, entry);
    });

    const claims = new Map();
    data.claims.forEach((entry, index) => {
        const path = `claims[${index}]`;
        if (!isRecord(entry)) {
            fail(path, "must be an object.");
            return;
        }
        registerId(entry, path, "claim");
        checkString(entry, "statement", path);
        checkStatus(entry, "verificationStatus", VERIFICATION_STATUSES, path);
        checkStatus(entry, "reviewStatus", REVIEW_STATUSES, path);
        checkIdList(entry.entityIds, "entityIds", path);
        checkIdList(entry.sourceIds, "sourceIds", path);
        if (isNonEmptyString(entry.id)) claims.set(entry.id, entry);
    });

    const checkReferences = (entries, field, validIds, collection) => {
        entries.forEach((entry, index) => {
            if (!isRecord(entry) || !Array.isArray(entry[field])) return;
            entry[field].forEach((id, itemIndex) => {
                if (isNonEmptyString(id) && !validIds.has(id)) {
                    fail(`${collection}[${index}].${field}[${itemIndex}]`, `references unknown ID ${id}.`);
                }
            });
        });
    };
    checkReferences(data.claims, "entityIds", entities, "claims");
    checkReferences(data.claims, "sourceIds", sources, "claims");
    for (const [id, entity] of entities) {
        if (entity.franchiseEntityId) {
            const franchise = entities.get(entity.franchiseEntityId);
            if (!franchise) {
                fail(`entities.${id}.franchiseEntityId`, `references unknown entity ID ${entity.franchiseEntityId}.`);
            } else if (!["franchise", "series"].includes(franchise.kind)) {
                fail(`entities.${id}.franchiseEntityId`, "must reference a franchise or series entity.");
            }
        }
    }

    data.transformations.forEach((entry, index) => {
        const path = `transformations[${index}]`;
        if (!isRecord(entry)) {
            fail(path, "must be an object.");
            return;
        }
        registerId(entry, path, "transform");
        checkString(entry, "gameFormatId", path);
        checkStatus(entry, "reviewStatus", REVIEW_STATUSES, path);
        checkIdList(entry.entityIds, "entityIds", path);
        checkIdList(entry.claimIds, "claimIds", path);
        if (!isRecord(entry.payload)) fail(`${path}.payload`, "is required and must be an object.");
        if (Array.isArray(entry.entityIds) && Array.isArray(entry.claimIds)) {
            const claimEntityIds = new Set(entry.claimIds.flatMap((claimId) =>
                claims.get(claimId)?.entityIds ?? []
            ));
            entry.entityIds.forEach((entityId, entityIndex) => {
                if (isNonEmptyString(entityId) && !claimEntityIds.has(entityId)) {
                    fail(`${path}.entityIds[${entityIndex}]`, "must be referenced by at least one linked claim.");
                }
            });
        }
    });
    checkReferences(data.transformations, "entityIds", entities, "transformations");
    checkReferences(data.transformations, "claimIds", claims, "transformations");

    return { valid: errors.length === 0, errors };
}

module.exports = { validateCanonicalContent };
