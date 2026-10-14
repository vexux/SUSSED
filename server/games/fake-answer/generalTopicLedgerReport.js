const fs = require("node:fs");
const path = require("node:path");
const { decodeUtf8 } = require("../../content/textIntegrity");

const GAME_ID = "fact-or-cap";
const DEFAULT_LOW_TOPIC_THRESHOLD = 5;

function readPublishedPacks(contentDirectory, fileSystem = fs) {
    const packs = [];
    const errors = [];
    let fileNames;
    try {
        fileNames = fileSystem.readdirSync(contentDirectory)
            .filter((name) => name.endsWith(".json"))
            .sort();
    } catch (error) {
        return { packs, errors: [`Unable to list published content directory: ${error.message}`] };
    }
    for (const fileName of fileNames) {
        const filePath = path.join(contentDirectory, fileName);
        try {
            const data = JSON.parse(decodeUtf8(fileSystem.readFileSync(filePath), filePath));
            const questions = Array.isArray(data) ? data : data?.questions;
            if (!Array.isArray(questions)) {
                errors.push(`${fileName}: pack must contain a questions array.`);
                continue;
            }
            packs.push({ fileName, contentPackId: data?.contentPackId ?? null, questions });
        } catch (error) {
            errors.push(`${fileName}: unable to read pack: ${error.message}`);
        }
    }
    return { packs, errors };
}

function identityKey(identity) {
    return [identity?.gameId, identity?.contentPackId, identity?.questionId].join("/");
}

function validateLedgerShape(ledger) {
    const errors = [];
    const taxonomy = new Map();
    if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
        return { errors: ["Ledger must be a JSON object."], taxonomy };
    }
    if (ledger.ledgerVersion !== 1) errors.push(`Unsupported ledgerVersion: ${ledger.ledgerVersion ?? "missing"}.`);
    if (!Array.isArray(ledger.taxonomy)) errors.push("Ledger taxonomy must be an array.");
    else {
        for (const topic of ledger.taxonomy) {
            if (!topic || typeof topic.topicId !== "string" || !topic.topicId) {
                errors.push("Every taxonomy entry must have a non-empty topicId.");
                continue;
            }
            if (taxonomy.has(topic.topicId)) errors.push(`Duplicate taxonomy topicId: ${topic.topicId}.`);
            const subtopics = Array.isArray(topic.subtopics) ? topic.subtopics : [];
            if (topic.subtopics !== undefined && !Array.isArray(topic.subtopics)) {
                errors.push(`Topic ${topic.topicId} subtopics must be an array.`);
            }
            if (subtopics.some((id) => typeof id !== "string" || !id)) errors.push(`Topic ${topic.topicId} has an invalid subtopic ID.`);
            if (new Set(subtopics).size !== subtopics.length) errors.push(`Topic ${topic.topicId} has duplicate subtopic IDs.`);
            taxonomy.set(topic.topicId, new Set(subtopics));
        }
    }
    if (!Array.isArray(ledger.questionRecords)) errors.push("Ledger questionRecords must be an array.");
    if (!Array.isArray(ledger.repetitionReviewClusters)) errors.push("Ledger repetitionReviewClusters must be an array.");
    if (!Array.isArray(ledger.suspectedSemanticDuplicates)) errors.push("Ledger suspectedSemanticDuplicates must be an array.");
    if (!Array.isArray(ledger.classificationConventions?.questionTypes) || ledger.classificationConventions.questionTypes.length === 0) {
        errors.push("Ledger classificationConventions.questionTypes must be a non-empty array.");
    } else {
        if (ledger.classificationConventions.questionTypes.some((type) => typeof type !== "string" || !type)) errors.push("Ledger questionTypes must contain non-empty strings.");
        if (new Set(ledger.classificationConventions.questionTypes).size !== ledger.classificationConventions.questionTypes.length) errors.push("Ledger questionTypes must be unique.");
    }
    return { errors, taxonomy };
}

function compareGeneralTopicLedger({ ledger, contentDirectory, fileSystem = fs, lowTopicThreshold = DEFAULT_LOW_TOPIC_THRESHOLD }) {
    const shape = validateLedgerShape(ledger);
    const errors = [...shape.errors];
    const editorialNotes = [];
    const readResult = readPublishedPacks(contentDirectory, fileSystem);
    errors.push(...readResult.errors);

    const published = new Map();
    const packCounts = [];
    for (const pack of readResult.packs) {
        packCounts.push({ contentPackId: pack.contentPackId, fileName: pack.fileName, questionCount: pack.questions.length });
        if (pack.contentPackId !== path.basename(pack.fileName, ".json")) {
            errors.push(`${pack.fileName}: contentPackId does not match the published filename.`);
        }
        for (const question of pack.questions) {
            const key = identityKey({ gameId: GAME_ID, contentPackId: pack.contentPackId, questionId: question?.id });
            if (published.has(key)) errors.push(`Duplicate published identity: ${key}.`);
            published.set(key, { question, pack });
        }
    }

    const snapshotPacks = ledger?.baselineSnapshot?.contentPacks;
    if (!Array.isArray(snapshotPacks)) {
        errors.push("Ledger baselineSnapshot.contentPacks must be an array.");
    } else {
        const snapshotById = new Map();
        for (const pack of snapshotPacks) {
            if (!pack?.contentPackId || snapshotById.has(pack.contentPackId)) {
                errors.push(`Invalid or duplicate baseline snapshot pack membership: ${pack?.contentPackId ?? "missing contentPackId"}.`);
            } else snapshotById.set(pack.contentPackId, pack);
        }
        for (const pack of readResult.packs) {
            const snapshot = snapshotById.get(pack.contentPackId);
            if (!snapshot) errors.push(`Published pack is missing from ledger baseline snapshot: ${pack.contentPackId}.`);
            else {
                if (snapshot.fileName !== pack.fileName) errors.push(`Ledger baseline snapshot has stale filename for pack ${pack.contentPackId}.`);
                if (snapshot.questionCount !== pack.questions.length) errors.push(`Ledger baseline snapshot has stale question count for pack ${pack.contentPackId}.`);
            }
        }
        for (const packId of snapshotById.keys()) {
            if (!readResult.packs.some((pack) => pack.contentPackId === packId)) errors.push(`Ledger baseline snapshot references unpublished pack: ${packId}.`);
        }
        const snapshotQuestionCount = snapshotPacks.reduce((total, pack) => total + (Number.isInteger(pack?.questionCount) ? pack.questionCount : 0), 0);
        if (ledger?.baselineSnapshot?.publishedQuestionCount !== snapshotQuestionCount) errors.push("Ledger baseline snapshot question total disagrees with its pack counts.");
        if (ledger?.baselineSnapshot?.publishedQuestionCount !== published.size) errors.push("Ledger baseline snapshot question total is stale relative to published packs.");
        if (ledger?.baselineSnapshot?.publishedContentPackCount !== readResult.packs.length) errors.push("Ledger baseline snapshot pack total is stale relative to published packs.");
        const attributionCount = [...published.values()].filter(({ question }) => Boolean(question.sourceName && question.sourceUrl)).length;
        if (ledger?.baselineSnapshot?.attributionMetadataPresentCount !== attributionCount) errors.push("Ledger baseline snapshot source-attribution count is stale relative to published packs.");
    }

    const ledgerMap = new Map();
    const validTopicCounts = new Map([...shape.taxonomy.keys()].map((id) => [id, 0]));
    const validSubtopicCounts = new Map();
    for (const topic of ledger?.taxonomy ?? []) {
        for (const subtopicId of topic?.subtopics ?? []) {
            validSubtopicCounts.set(`${topic.topicId}/${subtopicId}`, 0);
        }
    }
    const typeCounts = new Map((ledger?.classificationConventions?.questionTypes ?? []).map((type) => [type, 0]));
    const acceptedQuestionTypes = new Set(ledger?.classificationConventions?.questionTypes ?? []);

    for (const [index, record] of (ledger?.questionRecords ?? []).entries()) {
        const identity = record?.legacyIdentity;
        const key = identityKey(identity);
        const displayKey = key.replace(/^\/|\/$/gu, "");
        if (!identity || identity.gameId !== GAME_ID || typeof identity.contentPackId !== "string" || !identity.contentPackId || typeof identity.questionId !== "string" || !identity.questionId) {
            errors.push(`Ledger record ${index + 1} has an invalid legacyIdentity (expected gameId, contentPackId, and questionId).`);
        }
        if (!record?.legacyMetadata || typeof record.legacyMetadata !== "object" || Array.isArray(record.legacyMetadata)) errors.push(`${displayKey}: legacyMetadata must be an object.`);
        if (!record?.sourceReview || typeof record.sourceReview !== "object" || Array.isArray(record.sourceReview)) errors.push(`${displayKey}: sourceReview must be an object.`);
        if (ledgerMap.has(key)) errors.push(`Duplicate ledger identity: ${displayKey}.`);
        else ledgerMap.set(key, record);

        const publishedRecord = published.get(key);
        if (!publishedRecord && identity?.questionId) {
            const elsewhere = [...published.entries()].find(([, entry]) => entry.question?.id === identity.questionId);
            if (elsewhere) {
                errors.push(`Incorrect pack membership for ${displayKey}; question exists at ${elsewhere[0]}.`);
            } else {
                errors.push(`Ledger question no longer exists in published packs: ${displayKey}.`);
            }
        } else if (publishedRecord) {
            const question = publishedRecord.question;
            const metadata = record?.legacyMetadata ?? {};
            if ((metadata.category ?? null) !== (question.category ?? null)) errors.push(`${displayKey}: copied category is stale.`);
            if (JSON.stringify(metadata.tags ?? []) !== JSON.stringify(question.tags ?? [])) errors.push(`${displayKey}: copied tags are stale.`);
            if ((metadata.difficulty ?? null) !== (question.difficulty ?? null)) errors.push(`${displayKey}: copied difficulty is stale.`);
            const source = record?.sourceReview ?? {};
            const hasAttribution = Boolean(question.sourceName && question.sourceUrl);
            if (typeof source.attributionMetadataPresent !== "boolean") errors.push(`${displayKey}: attributionMetadataPresent must be boolean.`);
            if (source.claimVerification !== "not-assessed-by-this-ledger") errors.push(`${displayKey}: claimVerification must remain not-assessed-by-this-ledger in this planning ledger.`);
            if (source.claimSourceSupport !== "not-assessed-by-this-ledger") errors.push(`${displayKey}: claimSourceSupport must remain not-assessed-by-this-ledger in this planning ledger.`);
            if (source.rightsOrReuse !== "unknown") errors.push(`${displayKey}: rightsOrReuse must remain unknown in this planning ledger.`);
            if ((source.sourceName ?? null) !== (question.sourceName ?? null)) errors.push(`${displayKey}: copied sourceName is stale.`);
            if ((source.sourceUrl ?? null) !== (question.sourceUrl ?? null)) errors.push(`${displayKey}: copied sourceUrl is stale.`);
            if (source.attributionMetadataPresent !== hasAttribution) errors.push(`${displayKey}: copied attribution-presence flag is stale.`);
        }

        const classification = record?.editorialClassification;
        if (!classification || typeof classification !== "object") {
            errors.push(`${displayKey}: editorialClassification is missing.`);
        } else {
            if (typeof classification.underlyingClaimSummary !== "string" || !classification.underlyingClaimSummary.trim()) errors.push(`${displayKey}: underlyingClaimSummary is required.`);
            if (typeof classification.questionType !== "string" || !classification.questionType) errors.push(`${displayKey}: questionType is required.`);
            const subtopics = shape.taxonomy.get(classification.topicId);
            if (!subtopics) errors.push(`${displayKey}: unresolved topicId "${classification.topicId}".`);
            else if (!subtopics.has(classification.subtopicId)) errors.push(`${displayKey}: unresolved subtopicId "${classification.topicId}/${classification.subtopicId}".`);
            else {
                validTopicCounts.set(classification.topicId, validTopicCounts.get(classification.topicId) + 1);
                const subtopicKey = `${classification.topicId}/${classification.subtopicId}`;
                validSubtopicCounts.set(subtopicKey, validSubtopicCounts.get(subtopicKey) + 1);
            }
            if (!acceptedQuestionTypes.has(classification.questionType)) {
                errors.push(`${displayKey}: unresolved questionType "${classification.questionType}".`);
            } else {
                typeCounts.set(classification.questionType, (typeCounts.get(classification.questionType) ?? 0) + 1);
            }
            if (classification.status !== "provisional-editorial-classification") {
                editorialNotes.push(`${displayKey}: classification status is ${classification.status ?? "missing"}; confirm its intended editorial meaning.`);
            }
            if (classification.uncertaintyNote) editorialNotes.push(`${displayKey}: classification uncertainty: ${classification.uncertaintyNote}`);
        }
    }

    for (const key of published.keys()) {
        if (!ledgerMap.has(key)) errors.push(`Published question is missing from ledger: ${key}.`);
    }

    const validateReferences = (records, label) => {
        for (const [index, record] of records.entries()) {
            if (!Array.isArray(record?.questionIds) || record.questionIds.length === 0) {
                errors.push(`${label} ${index + 1} must reference at least one questionId.`);
                continue;
            }
            for (const questionId of record.questionIds) {
                const matches = [...ledgerMap.values()].filter((entry) => entry?.legacyIdentity?.questionId === questionId);
                if (matches.length !== 1) errors.push(`${label} ${index + 1} questionId "${questionId}" resolves to ${matches.length} ledger records.`);
            }
        }
    };
    validateReferences(ledger?.repetitionReviewClusters ?? [], "Repetition-review cluster");
    validateReferences(ledger?.suspectedSemanticDuplicates ?? [], "Suspected semantic duplicate");

    const topicRows = (ledger?.taxonomy ?? []).map((topic) => ({
        topicId: topic.topicId,
        label: topic.label ?? topic.topicId,
        count: validTopicCounts.get(topic.topicId) ?? 0,
        lowCoverage: (validTopicCounts.get(topic.topicId) ?? 0) < lowTopicThreshold,
        subtopics: (topic.subtopics ?? []).map((subtopicId) => ({
            subtopicId,
            count: validSubtopicCounts.get(`${topic.topicId}/${subtopicId}`) ?? 0,
            lowCoverage: (validSubtopicCounts.get(`${topic.topicId}/${subtopicId}`) ?? 0) < lowTopicThreshold
        }))
    }));
    const topicCountsByType = Object.fromEntries([...typeCounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const totalQuestions = [...published.values()].length;
    return {
        reconciliation: {
            valid: errors.length === 0,
            errors: [...new Set(errors)].sort(),
            publishedQuestionCount: totalQuestions,
            publishedPackCount: readResult.packs.length,
            ledgerRecordCount: ledger?.questionRecords?.length ?? 0,
            packCounts: packCounts.sort((a, b) => String(a.contentPackId).localeCompare(String(b.contentPackId)))
        },
        coverage: {
            lowTopicThreshold,
            topicCounts: topicRows,
            questionTypeCounts: topicCountsByType,
            unclassifiedPublishedQuestions: Math.max(0, totalQuestions - [...validTopicCounts.values()].reduce((sum, count) => sum + count, 0))
        },
        editorialNotes: editorialNotes.sort(),
        repetitionReviewClusters: ledger?.repetitionReviewClusters ?? [],
        suspectedSemanticDuplicates: ledger?.suspectedSemanticDuplicates ?? []
    };
}

function formatGeneralTopicLedgerReport(report) {
    const { reconciliation, coverage } = report;
    const lines = [
        "General Fact-or-Cap coverage and ledger reconciliation",
        `Reconciliation: ${reconciliation.valid ? "VALID" : "INVALID"}`,
        `Published questions: ${reconciliation.publishedQuestionCount}; packs: ${reconciliation.publishedPackCount}; ledger records: ${reconciliation.ledgerRecordCount}`,
        "Packs:"
    ];
    for (const pack of reconciliation.packCounts) lines.push(`  - ${pack.contentPackId} (${pack.fileName}): ${pack.questionCount}`);
    if (reconciliation.errors.length) lines.push(`Structural/membership errors (${reconciliation.errors.length}):`, ...reconciliation.errors.map((error) => `  - ${error}`));
    lines.push(`\nCoverage counts (low threshold: fewer than ${coverage.lowTopicThreshold}):`, "Topics and subtopics:");
    for (const topic of coverage.topicCounts) {
        lines.push(`  - ${topic.label}: ${topic.count}${topic.lowCoverage ? " [LOW]" : ""}`);
        for (const subtopic of topic.subtopics) lines.push(`      ${subtopic.subtopicId}: ${subtopic.count}${subtopic.lowCoverage ? " [LOW]" : ""}`);
    }
    lines.push("Question types:");
    for (const [type, count] of Object.entries(coverage.questionTypeCounts)) lines.push(`  - ${type}: ${count}`);
    lines.push(`Unclassified published questions: ${coverage.unclassifiedPublishedQuestions}`);
    lines.push("\nEditorial repetition notes (human review signals, not confirmed duplicates):");
    for (const cluster of report.repetitionReviewClusters) lines.push(`  - ${cluster.clusterId}: ${cluster.questionIds.join(", ")} — ${cluster.note} [${cluster.status}]`);
    for (const overlap of report.suspectedSemanticDuplicates) lines.push(`  - Possible overlap: ${overlap.questionIds.join(" / ")} — ${overlap.note} [${overlap.status}]`);
    lines.push("\nEditorial classification / uncertainty notes:");
    if (report.editorialNotes.length) lines.push(...report.editorialNotes.map((note) => `  - ${note}`));
    else lines.push("  - None recorded.");
    lines.push("\nThis report does not inspect source pages or assess factual accuracy, source support, licensing, reuse rights, or publication approval.");
    return lines.join("\n");
}

module.exports = {
    DEFAULT_LOW_TOPIC_THRESHOLD,
    compareGeneralTopicLedger,
    formatGeneralTopicLedgerReport,
    validateLedgerShape
};
