const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
    compareGeneralTopicLedger,
    validateLedgerShape
} = require("./generalTopicLedgerReport");
const { validateQuestionPack } = require("./questionLibrary");
const { decodeUtf8 } = require("../../content/textIntegrity");

const GAME_ID = "fact-or-cap";
const REPETITION_OUTCOMES = new Set(["no-known-overlap", "flagged"]);

function readPacks(contentDirectory, fileSystem = fs) {
    const packs = [];
    const errors = [];
    let files;
    try {
        files = fileSystem.readdirSync(contentDirectory).filter((file) => file.endsWith(".json")).sort();
    } catch (error) {
        return { packs, errors: [`Unable to read published packs: ${error.message}`] };
    }
    for (const fileName of files) {
        const filePath = path.join(contentDirectory, fileName);
        try {
            const pack = JSON.parse(decodeUtf8(fileSystem.readFileSync(filePath), filePath));
            if (!pack || typeof pack.contentPackId !== "string" || !Array.isArray(pack.questions)) {
                errors.push(`${fileName}: expected contentPackId and questions array.`);
                continue;
            }
            const validation = validateQuestionPack(pack, fileName);
            errors.push(...validation.errors);
            packs.push({ fileName, contentPackId: pack.contentPackId, questions: pack.questions });
        } catch (error) {
            errors.push(`${fileName}: unable to parse pack: ${error.message}`);
        }
    }
    return { packs, errors };
}

function key(packId, questionId) {
    return `${GAME_ID}/${packId}/${questionId}`;
}

function jsonClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function deriveRecord(pack, question, classification) {
    return {
        legacyIdentity: { gameId: GAME_ID, contentPackId: pack.contentPackId, questionId: question.id },
        editorialClassification: {
            topicId: classification.topicId,
            subtopicId: classification.subtopicId,
            questionType: classification.questionType,
            underlyingClaimSummary: classification.underlyingClaimSummary.trim(),
            status: "provisional-editorial-classification",
            uncertaintyNote: null,
            repetitionReview: {
                outcome: classification.repetitionReview.outcome,
                note: classification.repetitionReview.note.trim()
            }
        },
        legacyMetadata: {
            category: question.category ?? null,
            tags: question.tags ?? [],
            difficulty: question.difficulty ?? null
        },
        sourceReview: {
            attributionMetadataPresent: Boolean(question.sourceName && question.sourceUrl),
            sourceName: question.sourceName ?? null,
            sourceUrl: question.sourceUrl ?? null,
            claimVerification: "not-assessed-by-this-ledger",
            claimSourceSupport: "not-assessed-by-this-ledger",
            rightsOrReuse: "unknown"
        }
    };
}

function classificationMatchesRecord(classification, record) {
    const expected = record.editorialClassification;
    return typeof classification.underlyingClaimSummary === "string" &&
        typeof classification.repetitionReview?.note === "string" &&
        classification.topicId === expected.topicId &&
        classification.subtopicId === expected.subtopicId &&
        classification.questionType === expected.questionType &&
        classification.underlyingClaimSummary.trim() === expected.underlyingClaimSummary &&
        classification.repetitionReview?.outcome === expected.repetitionReview?.outcome &&
        classification.repetitionReview?.note?.trim() === expected.repetitionReview?.note;
}

function validateManifest(manifest) {
    const errors = [];
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["Classification manifest must be an object."];
    if (manifest.manifestVersion !== 1) errors.push(`Unsupported manifestVersion: ${manifest.manifestVersion ?? "missing"}.`);
    if (!Array.isArray(manifest.classifications)) errors.push("Classification manifest must contain a classifications array.");
    for (const field of ["repetitionReviewClusters", "suspectedSemanticDuplicates"]) {
        if (manifest[field] !== undefined && !Array.isArray(manifest[field])) errors.push(`${field} must be an array when provided.`);
    }
    return errors;
}

function filterExpectedMissingErrors(report, missingKeys, changedPackIds) {
    return report.reconciliation.errors.filter((error) => {
        const missingQuestion = error.match(/^Published question is missing from ledger: (.+)\.$/u);
        if (missingQuestion && missingKeys.has(missingQuestion[1])) return false;
        const newPack = error.match(/^Published pack is missing from ledger baseline snapshot: (.+)\.$/u);
        if (newPack && changedPackIds.has(newPack[1])) return false;
        const stalePackCount = error.match(/^Ledger baseline snapshot has stale question count for pack (.+)\.$/u);
        if (stalePackCount && changedPackIds.has(stalePackCount[1])) return false;
        if (/^Ledger baseline snapshot question total is stale/u.test(error)) return false;
        if (/^Ledger baseline snapshot pack total is stale/u.test(error)) return false;
        if (/^Ledger baseline snapshot source-attribution count is stale/u.test(error)) return false;
        return true;
    });
}

function validateSnapshotAdditions(ledger, packs, missing) {
    const errors = [];
    const snapshot = ledger.baselineSnapshot;
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.contentPacks) ||
        !Number.isInteger(snapshot.publishedQuestionCount) || !Number.isInteger(snapshot.publishedContentPackCount) ||
        !Number.isInteger(snapshot.attributionMetadataPresentCount)) {
        return ["Ledger baselineSnapshot is incomplete or malformed; refusing to refresh it."];
    }
    const snapshotPacks = snapshot.contentPacks;
    const priorById = new Map(snapshotPacks.map((pack) => [pack.contentPackId, pack]));
    const missingPerPack = new Map();
    let newAttributions = 0;
    for (const { pack, question } of missing.values()) {
        missingPerPack.set(pack.contentPackId, (missingPerPack.get(pack.contentPackId) ?? 0) + 1);
        if (question.sourceName && question.sourceUrl) newAttributions += 1;
    }
    let newPackCount = 0;
    for (const pack of packs) {
        const prior = priorById.get(pack.contentPackId);
        if (!prior) {
            newPackCount += 1;
            if ((missingPerPack.get(pack.contentPackId) ?? 0) !== pack.questions.length) {
                errors.push(`New published pack ${pack.contentPackId} has questions that are not all classified as new ledger records.`);
            }
            continue;
        }
        if (prior.fileName !== pack.fileName) errors.push(`Cannot maintain ledger: existing pack ${pack.contentPackId} changed filename.`);
        if (prior.questionCount + (missingPerPack.get(pack.contentPackId) ?? 0) !== pack.questions.length) {
            errors.push(`Cannot maintain ledger: pack ${pack.contentPackId} has changes beyond newly published questions.`);
        }
    }
    for (const prior of snapshotPacks) {
        if (!packs.some((pack) => pack.contentPackId === prior.contentPackId)) {
            errors.push(`Cannot maintain ledger while baseline pack ${prior.contentPackId} is absent from published content.`);
        }
    }
    const priorQuestionCount = snapshotPacks.reduce((total, pack) => total + pack.questionCount, 0);
    const publishedQuestionCount = packs.reduce((total, pack) => total + pack.questions.length, 0);
    if (snapshot.publishedQuestionCount !== priorQuestionCount || priorQuestionCount + missing.size !== publishedQuestionCount) {
        errors.push("Cannot maintain ledger: published question-count changes are not explained solely by newly classified questions.");
    }
    if (snapshot.publishedContentPackCount !== snapshotPacks.length || snapshotPacks.length + newPackCount !== packs.length) {
        errors.push("Cannot maintain ledger: published pack-count changes are not explained solely by new packs containing new questions.");
    }
    const publishedAttributions = packs.flatMap((pack) => pack.questions)
        .filter((question) => Boolean(question.sourceName && question.sourceUrl)).length;
    if (snapshot.attributionMetadataPresentCount + newAttributions !== publishedAttributions) {
        errors.push("Cannot maintain ledger: attribution-count changes are not explained solely by newly classified questions.");
    }
    return errors;
}

function computeDistribution(ledger) {
    const topicCounts = Object.fromEntries(ledger.taxonomy.map((topic) => [topic.topicId, 0]));
    const questionTypeCounts = Object.fromEntries(ledger.classificationConventions.questionTypes.map((type) => [type, 0]));
    for (const record of ledger.questionRecords) {
        const classification = record.editorialClassification;
        topicCounts[classification.topicId] = (topicCounts[classification.topicId] ?? 0) + 1;
        questionTypeCounts[classification.questionType] = (questionTypeCounts[classification.questionType] ?? 0) + 1;
    }
    return {
        basis: ledger.baselineSnapshot.editorialDistribution?.basis ??
            "Provisional editorial classifications in this ledger; counts are planning signals, not independently verified subject truth.",
        topicCounts,
        questionTypeCounts
    };
}

function appendReviewNotes(current, additions, label, errors) {
    const result = [...(current ?? [])];
    const existingIds = new Set(result.map((record) => record.clusterId).filter(Boolean));
    const existingSemanticSets = new Set(result.map((record) => [...(record.questionIds ?? [])].sort().join("\u0000")));
    for (const [index, record] of (additions ?? []).entries()) {
        if (!record || !Array.isArray(record.questionIds) || record.questionIds.length < 1 ||
            typeof record.note !== "string" || !record.note.trim() || typeof record.status !== "string" || !record.status.trim()) {
            errors.push(`${label} ${index + 1} requires questionIds, a non-empty note, and a status.`);
            continue;
        }
        const ids = [...new Set(record.questionIds)];
        if (ids.length !== record.questionIds.length) errors.push(`${label} ${index + 1} repeats a questionId.`);
        if (label === "Repetition-review cluster") {
            if (typeof record.clusterId !== "string" || !record.clusterId.trim()) errors.push(`${label} ${index + 1} requires clusterId.`);
            else if (existingIds.has(record.clusterId)) errors.push(`${label} clusterId already exists: ${record.clusterId}.`);
            else existingIds.add(record.clusterId);
        } else {
            const semanticKey = [...ids].sort().join("\u0000");
            if (existingSemanticSets.has(semanticKey)) errors.push(`${label} ${index + 1} duplicates an existing question set.`);
            existingSemanticSets.add(semanticKey);
        }
        result.push(jsonClone({ ...record, questionIds: ids, note: record.note.trim() }));
    }
    return result;
}

function buildGeneralTopicLedgerUpdate({ ledger, manifest, contentDirectory, fileSystem = fs }) {
    const errors = [...validateManifest(manifest)];
    const shape = validateLedgerShape(ledger);
    errors.push(...shape.errors);
    const loaded = readPacks(contentDirectory, fileSystem);
    errors.push(...loaded.errors);
    if (errors.length) return { valid: false, errors: [...new Set(errors)].sort(), addedRecords: [], updatedLedger: null };

    const packById = new Map();
    const publishedByKey = new Map();
    const publishedQuestionIds = new Map();
    for (const pack of loaded.packs) {
        if (pack.contentPackId !== path.basename(pack.fileName, ".json")) errors.push(`${pack.fileName}: contentPackId does not match the published filename.`);
        if (packById.has(pack.contentPackId)) errors.push(`Duplicate published contentPackId: ${pack.contentPackId}.`);
        packById.set(pack.contentPackId, pack);
        for (const question of pack.questions) {
            if (typeof question?.id !== "string" || !question.id) {
                errors.push(`${pack.fileName}: every published question must have a stable non-empty id.`);
                continue;
            }
            const identityKey = key(pack.contentPackId, question.id);
            if (publishedByKey.has(identityKey)) errors.push(`Duplicate published question identity: ${identityKey}.`);
            publishedByKey.set(identityKey, { pack, question });
            const ids = publishedQuestionIds.get(question.id) ?? [];
            ids.push(identityKey);
            publishedQuestionIds.set(question.id, ids);
        }
    }
    for (const [id, identities] of publishedQuestionIds) if (identities.length > 1) errors.push(`Published question ID is ambiguous across packs: ${id}.`);

    const currentRecords = new Map();
    for (const [index, record] of ledger.questionRecords.entries()) {
        const id = record?.legacyIdentity;
        if (!record || typeof record !== "object" || !id || typeof id.contentPackId !== "string" || typeof id.questionId !== "string") {
            errors.push(`Existing ledger record ${index + 1} has an invalid identity and cannot be maintained safely.`);
            continue;
        }
        const recordKey = key(id.contentPackId, id.questionId);
        if (currentRecords.has(recordKey)) errors.push(`Duplicate existing ledger identity: ${recordKey}.`);
        currentRecords.set(recordKey, record);
    }
    const missing = new Map([...publishedByKey].filter(([identityKey]) => !currentRecords.has(identityKey)));
    const missingKeys = new Set(missing.keys());
    const changedPackIds = new Set([...missing.values()].map(({ pack }) => pack.contentPackId));
    const currentReport = compareGeneralTopicLedger({ ledger, contentDirectory, fileSystem });
    const snapshotErrors = validateSnapshotAdditions(ledger, loaded.packs, missing);
    errors.push(...snapshotErrors);
    if (snapshotErrors.length === 0) {
        errors.push(...filterExpectedMissingErrors(currentReport, missingKeys, changedPackIds));
    } else {
        errors.push(...currentReport.reconciliation.errors);
    }

    const classifications = manifest.classifications;
    const classificationByKey = new Map();
    for (const [index, classification] of classifications.entries()) {
        if (!classification || typeof classification.contentPackId !== "string" || typeof classification.questionId !== "string" ||
            !classification.contentPackId || !classification.questionId) {
            errors.push(`Classification ${index + 1} requires contentPackId and questionId.`);
            continue;
        }
        const classificationKey = key(classification.contentPackId, classification.questionId);
        if (classificationByKey.has(classificationKey)) {
            errors.push(`Duplicate classification identity: ${classificationKey}.`);
            continue;
        }
        classificationByKey.set(classificationKey, classification);
        const publishedEntry = publishedByKey.get(classificationKey);
        if (!publishedEntry) {
            errors.push(`Classification identity is not a published General question: ${classificationKey}.`);
            continue;
        }
        const existing = currentRecords.get(classificationKey);
        if (existing) {
            if (!classificationMatchesRecord(classification, existing)) errors.push(`Classification would overwrite existing editorial record: ${classificationKey}.`);
            continue;
        }
        if (!shape.taxonomy.has(classification.topicId)) errors.push(`${classificationKey}: invalid topicId "${classification.topicId}".`);
        else if (!shape.taxonomy.get(classification.topicId).has(classification.subtopicId)) errors.push(`${classificationKey}: invalid subtopicId "${classification.topicId}/${classification.subtopicId}".`);
        if (!ledger.classificationConventions.questionTypes.includes(classification.questionType)) errors.push(`${classificationKey}: invalid questionType "${classification.questionType}".`);
        if (typeof classification.underlyingClaimSummary !== "string" || !classification.underlyingClaimSummary.trim()) errors.push(`${classificationKey}: underlyingClaimSummary is required.`);
        if (!classification.repetitionReview || !REPETITION_OUTCOMES.has(classification.repetitionReview.outcome) ||
            typeof classification.repetitionReview.note !== "string" || !classification.repetitionReview.note.trim()) {
            errors.push(`${classificationKey}: repetitionReview requires outcome (no-known-overlap or flagged) and a non-empty editorial note.`);
        }
    }
    for (const identityKey of missingKeys) if (!classificationByKey.has(identityKey)) errors.push(`Missing editorial classification for published question: ${identityKey}.`);
    if (errors.length) {
        return {
            valid: false,
            errors: [...new Set(errors)].sort(),
            addedRecords: [],
            updatedLedger: null,
            currentReconciliationErrors: currentReport.reconciliation.errors,
            resultingCounts: { questions: loaded.packs.reduce((count, pack) => count + pack.questions.length, 0), packs: loaded.packs.length }
        };
    }

    const updatedLedger = jsonClone(ledger);
    const addedRecords = [];
    for (const [identityKey, classification] of classificationByKey) {
        if (currentRecords.has(identityKey)) continue;
        const publishedEntry = publishedByKey.get(identityKey);
        if (publishedEntry) addedRecords.push(deriveRecord(publishedEntry.pack, publishedEntry.question, classification));
    }
    addedRecords.sort((left, right) =>
        key(left.legacyIdentity.contentPackId, left.legacyIdentity.questionId)
            .localeCompare(key(right.legacyIdentity.contentPackId, right.legacyIdentity.questionId))
    );
    updatedLedger.questionRecords.push(...addedRecords);

    updatedLedger.repetitionReviewClusters = appendReviewNotes(
        updatedLedger.repetitionReviewClusters,
        manifest.repetitionReviewClusters,
        "Repetition-review cluster",
        errors
    );
    updatedLedger.suspectedSemanticDuplicates = appendReviewNotes(
        updatedLedger.suspectedSemanticDuplicates,
        manifest.suspectedSemanticDuplicates,
        "Suspected semantic duplicate",
        errors
    );
    for (const [label, records] of [["Repetition-review cluster", updatedLedger.repetitionReviewClusters], ["Suspected semantic duplicate", updatedLedger.suspectedSemanticDuplicates]]) {
        for (const [index, record] of records.entries()) {
            for (const questionId of record.questionIds ?? []) {
                if ((publishedQuestionIds.get(questionId) ?? []).length !== 1) errors.push(`${label} ${index + 1} questionId "${questionId}" is missing or ambiguous in published packs.`);
            }
        }
    }

    const packSnapshot = loaded.packs.map((pack) => ({
        fileName: pack.fileName,
        contentPackId: pack.contentPackId,
        questionCount: pack.questions.length
    })).sort((left, right) => left.contentPackId.localeCompare(right.contentPackId));
    const allQuestions = loaded.packs.flatMap((pack) => pack.questions);
    updatedLedger.baselineSnapshot = {
        ...updatedLedger.baselineSnapshot,
        gameId: GAME_ID,
        publishedQuestionCount: allQuestions.length,
        publishedContentPackCount: loaded.packs.length,
        contentPacks: packSnapshot,
        attributionMetadataPresentCount: allQuestions.filter((question) => Boolean(question.sourceName && question.sourceUrl)).length
    };
    updatedLedger.baselineSnapshot.editorialDistribution = computeDistribution(updatedLedger);

    if (errors.length === 0) {
        const finalReport = compareGeneralTopicLedger({ ledger: updatedLedger, contentDirectory, fileSystem });
        errors.push(...finalReport.reconciliation.errors);
    }
    return {
        valid: errors.length === 0,
        errors: [...new Set(errors)].sort(),
        addedRecords,
        updatedLedger: errors.length === 0 ? updatedLedger : null,
        currentReconciliationErrors: currentReport.reconciliation.errors,
        resultingCounts: { questions: allQuestions.length, packs: loaded.packs.length }
    };
}

function writeLedgerAtomically(ledgerPath, ledger, fileSystem = fs) {
    const temporaryPath = path.join(path.dirname(ledgerPath), `.${path.basename(ledgerPath)}.${randomUUID()}.tmp`);
    let descriptor;
    try {
        descriptor = fileSystem.openSync(temporaryPath, "wx", 0o600);
        fileSystem.writeFileSync(descriptor, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
        fileSystem.fsyncSync(descriptor);
        fileSystem.closeSync(descriptor);
        descriptor = undefined;
        fileSystem.renameSync(temporaryPath, ledgerPath);
    } catch (error) {
        if (descriptor !== undefined) {
            try { fileSystem.closeSync(descriptor); } catch {}
        }
        try {
            if (fileSystem.existsSync(temporaryPath)) fileSystem.unlinkSync(temporaryPath);
        } catch (cleanupError) {
            throw new Error(`Ledger update failed (${error.message}); temporary-file cleanup failed (${cleanupError.message}).`);
        }
        throw new Error(`Could not atomically update ledger ${ledgerPath}: ${error.message}`);
    }
}

module.exports = { buildGeneralTopicLedgerUpdate, deriveRecord, writeLedgerAtomically };
