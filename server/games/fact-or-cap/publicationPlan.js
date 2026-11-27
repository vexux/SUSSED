const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { buildGeneralTopicLedgerUpdate } = require("./generalTopicLedgerPreview");
const { compareGeneralTopicLedger } = require("./generalTopicLedgerReport");
const { duplicateKey, validateQuestionPack } = require("./questionLibrary");
const { inspectBatch } = require("./questionBatchInspection");

const ROOT = path.resolve(__dirname);
const TARGETS = Object.freeze({
    "fact-or-cap": path.join(ROOT, "content", "general"),
    "fact-or-cap-anime": path.join(ROOT, "content", "anime")
});
const DEFAULT_PATHS = Object.freeze({
    generalLedger: path.join(ROOT, "research", "general-topic-ledger.json"),
    animeLedger: path.join(ROOT, "research", "anime-franchise-ledger.json"),
    incomingDirectory: path.join(ROOT, "incoming"),
    // Receipts are needed only between publication and guarded candidate
    // cleanup. Keep them outside the repository; the workflow is not an archive.
    temporaryEvidenceDirectory: path.join(os.tmpdir(), "sussed-content-publication", crypto.createHash("sha256").update(ROOT).digest("hex").slice(0, 16)),
    transactionDirectory: path.join(ROOT, ".publication-recovery")
});
const APPROVAL_VERSION = 1;
const REPORT_VERSION = 1;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/u;

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath, label, fileSystem = fs) {
    try {
        const bytes = fileSystem.readFileSync(filePath);
        return { value: JSON.parse(bytes.toString("utf8")), bytes };
    } catch (error) {
        throw new Error(`Unable to read ${label} "${filePath}": ${error.message}`);
    }
}

function questionContent(question) {
    const result = {};
    for (const field of ["text", "correctCompletion", "sourceName", "sourceUrl", "category", "tags", "difficulty"]) {
        if (question[field] !== undefined) result[field] = question[field];
    }
    return result;
}

function sameIdContent(left, right) {
    return isDeepStrictEqual(questionContent(left), questionContent(right));
}

function packQuestions(pack) {
    return Array.isArray(pack) ? pack : pack?.questions;
}

function loadPublished(directory, fileSystem = fs) {
    const packs = [];
    const errors = [];
    let names;
    try {
        names = fileSystem.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
    } catch (error) {
        return { packs, errors: [`Unable to list published content directory ${directory}: ${error.message}`] };
    }
    for (const fileName of names) {
        const filePath = path.join(directory, fileName);
        try {
            const data = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
            const validation = validateQuestionPack(data, filePath);
            errors.push(...validation.errors);
            packs.push({ fileName, filePath, contentPackId: data?.contentPackId ?? path.basename(fileName, ".json"), questions: validation.questions });
        } catch (error) {
            errors.push(`${filePath}: ${error.message}`);
        }
    }
    return { packs, errors };
}

const { makeAnimeLedgerUpdate } = require("./animeLedgerPreview");

function withPack(reader, directory, pack) {
    const name = pack.contentPackId + ".json";
    const destination = path.join(directory, name);
    if (reader.existsSync(destination)) throw new Error("Destination already exists.");
    const bytes = Buffer.from(JSON.stringify(pack, null, 2) + "\n");
    return {
        readdirSync: dir => dir === directory ? [...reader.readdirSync(dir), name].sort() : reader.readdirSync(dir),
        existsSync: file => file === destination || reader.existsSync(file),
        readFileSync: (file, encoding) => file !== destination ? reader.readFileSync(file, encoding) : encoding ? bytes.toString(encoding) : Buffer.from(bytes)
    };
}

function buildGeneralLedger(ledger, manifest, pack, existingDirectory, reader) {
    if (!isRecord(manifest) || manifest.manifestVersion !== 1 || !Array.isArray(manifest.classifications)) return { valid: false, errors: ["General publication requires a version-1 classification manifest."], updatedLedger: null };
    const fileSystem = withPack(reader, existingDirectory, pack);
    const result = buildGeneralTopicLedgerUpdate({ ledger, manifest, contentDirectory: existingDirectory, fileSystem });
    if (!result.valid || !result.updatedLedger) return result;
    const reconciliation = compareGeneralTopicLedger({ ledger: result.updatedLedger, contentDirectory: existingDirectory, fileSystem }).reconciliation;
    return { ...result, valid: reconciliation.valid, errors: reconciliation.errors, reconciliation };
}

function createReview({ target, inputPath, classificationPath, franchisePath, paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS }) {
    const blockers = [];
    const warnings = [];
    let previewErrors = [];
    let input;
    let sourceBytes;
    try {
        ({ value: input, bytes: sourceBytes } = readJson(path.resolve(inputPath), "candidate batch", fileSystem));
    } catch (error) {
        return { report: {
            reportVersion: REPORT_VERSION,
            target,
            inputPath: path.resolve(inputPath),
            contentPackId: null,
            candidateQuestionCount: 0,
            newQuestionIds: [],
            exactDuplicates: [],
            sameIdIdentical: [],
            conflictingIds: [],
            normalizedDuplicates: [],
            duplicateIds: [],
            withinBatchDuplicates: [],
            invalidEntries: [],
            perQuestion: [],
            semanticReview: { status: "not-assessed", note: "Candidate content could not be read." },
            proposedDestination: null,
            ledger: { status: "not-assessed", missingMetadataQuestionIds: [], errors: [] },
            blockers: [error.message],
            warnings,
            publicationEligible: false
        }, input: null };
    }
    const candidateQuestions = packQuestions(input);
    let contentPackId = input?.contentPackId;
    try {
        const preview = inspectBatch({ target, inputPath, fileSystem, contentDirectories });
        previewErrors = preview.errors;
        warnings.push(...preview.warnings);
    } catch (error) { previewErrors = [error.message]; }
    if (!Array.isArray(candidateQuestions)) blockers.push("Candidate must be a content-pack object with a questions array.");
    const packValidation = validateQuestionPack(input, path.resolve(inputPath));
    blockers.push(...packValidation.errors);
    const questions = packValidation.questions;
    if (!questions.length) blockers.push("Candidate batch must contain at least one structurally valid question.");
    const ids = new Set();
    for (const question of candidateQuestions ?? []) {
        if (ids.has(question?.id)) blockers.push(`Candidate repeats question ID "${question.id}".`);
        ids.add(question?.id);
        if (question?.contentPackId !== undefined && question.contentPackId !== contentPackId) blockers.push(`Question ${question.id} contentPackId differs from batch contentPackId.`);
    }
    const allPublished = Object.entries(contentDirectories).flatMap(([gameId, directory]) => {
        const loaded = loadPublished(directory, fileSystem);
        blockers.push(...loaded.errors.map((error) => `${gameId} published content: ${error}`));
        return loaded.packs.flatMap((pack) => pack.questions.map((question) => ({ gameId, packId: pack.contentPackId, packFile: pack.fileName, question })));
    });
    const targetRows = allPublished.filter(({ gameId }) => gameId === target);
    const publishedById = new Map();
    for (const row of targetRows) {
        const rows = publishedById.get(row.question.id) ?? [];
        rows.push(row); publishedById.set(row.question.id, rows);
    }
    const otherIds = new Set(allPublished.filter(({ gameId }) => gameId !== target).map(({ question }) => question.id));
    const duplicateIds = new Set();
    const exactDuplicates = [];
    const normalizedDuplicates = [];
    const sameIdIdentical = [];
    const conflictingIds = [];
    const withinBatchDuplicates = [];
    const perQuestion = [];
    for (const question of candidateQuestions ?? []) {
        const idRows = publishedById.get(question?.id) ?? [];
        if (otherIds.has(question?.id)) blockers.push(`Question ID ${question.id} is already used by the other registered content bank.`);
        if (idRows.length > 1) blockers.push(`Question ID ${question.id} is ambiguous in published content.`);
        let idStatus = "new";
        if (idRows.length) {
            duplicateIds.add(question.id);
            if (sameIdContent(question, idRows[0].question)) { idStatus = "same-id-identical"; sameIdIdentical.push({ candidateId: question.id, existingPackId: idRows[0].packId, existingPackFile: idRows[0].packFile }); }
            else { idStatus = "same-id-conflict"; conflictingIds.push({ candidateId: question.id, existingPackId: idRows[0].packId, existingPackFile: idRows[0].packFile, fields: Object.keys(questionContent(question)).filter((field) => !isDeepStrictEqual(questionContent(question)[field], questionContent(idRows[0].question)[field])) }); blockers.push(`Question ID ${question.id} conflicts with published content in ${idRows[0].packFile}.`); }
        }
        const comparable = typeof question?.text === "string" && typeof question?.correctCompletion === "string";
        const contentRows = comparable
            ? allPublished.filter(({ question: existing }) => duplicateKey(existing) === duplicateKey(question))
            : [];
        for (const row of contentRows) {
            const item = { candidateId: question?.id ?? null, existingQuestionId: row.question.id, existingPackId: row.packId, existingPackFile: row.packFile };
            if (question.text === row.question.text && question.correctCompletion === row.question.correctCompletion) exactDuplicates.push(item);
            else normalizedDuplicates.push(item);
        }
        perQuestion.push({ questionId: question?.id ?? null, idStatus, duplicateMatches: contentRows.map(({ gameId, question: existing, packId, packFile }) => ({ gameId, existingQuestionId: existing.id, existingPackId: packId, existingPackFile: packFile, kind: question.text === existing.text && question.correctCompletion === existing.correctCompletion ? "exact" : "normalized" })) });
    }
    // inspectBatch validates the combined legacy bank and candidate. Ignore only
    // duplicate-ID errors that involve this candidate and are classified above; a
    // pre-existing duplicate elsewhere in the published bank remains a blocker.
    const candidateIds = new Set((candidateQuestions ?? []).map((question) => question?.id).filter((id) => typeof id === "string"));
    for (const error of previewErrors) {
        if (error.includes(path.resolve(inputPath)) && /duplicates question ID/u.test(error)) continue;
        if (error.startsWith("Question IDs already used in another registered library:")) continue;
        const duplicateSummary = error.match(/^Duplicate question IDs: (.+)$/u);
        if (duplicateSummary && duplicateSummary[1].split(/,\s*/u).every((id) => candidateIds.has(id))) continue;
        blockers.push(error);
    }
    const candidateDuplicateMap = new Map();
    const seenCandidateKeys = new Set();
    const firstCandidateByKey = new Map();
    for (const question of candidateQuestions ?? []) {
        if (typeof question?.text !== "string" || typeof question?.correctCompletion !== "string") continue;
        const key = duplicateKey(question);
        if (seenCandidateKeys.has(key)) {
            candidateDuplicateMap.set(key, (candidateDuplicateMap.get(key) ?? 0) + 1);
            const first = firstCandidateByKey.get(key);
            withinBatchDuplicates.push({ firstCandidateId: first.id, duplicateCandidateId: question.id, kind: first.text === question.text && first.correctCompletion === question.correctCompletion ? "exact" : "normalized" });
        } else { seenCandidateKeys.add(key); firstCandidateByKey.set(key, question); }
    }
    for (const [key, count] of candidateDuplicateMap) blockers.push(`Candidate contains ${count + 1} questions with the same normalized prompt and completion (${key}).`);

    let ledger = null;
    let ledgerStatus = { valid: false, errors: [] };
    let metadataManifest = null;
    let metadataError = null;
    if (target === "fact-or-cap") {
        try {
            ledger = readJson(paths.generalLedger, "General topic ledger", fileSystem).value;
            ledgerStatus = compareGeneralTopicLedger({ ledger, contentDirectory: contentDirectories[target], fileSystem }).reconciliation;
        } catch (error) { ledgerStatus = { valid: false, errors: [error.message] }; }
        if (!ledgerStatus.valid) blockers.push(...ledgerStatus.errors.map((error) => `General ledger: ${error}`));
        if (!classificationPath) metadataError = "General publication requires --classifications with a version-1 ledger update manifest.";
        else { try { metadataManifest = readJson(classificationPath, "General classification manifest", fileSystem).value; } catch (error) { metadataError = error.message; } }
    } else {
        try {
            ledger = readJson(paths.animeLedger, "Anime franchise ledger", fileSystem).value;
            const loaded = loadPublished(contentDirectories[target], fileSystem);
            const baseline = makeAnimeLedgerUpdate(ledger, { manifestVersion: 1, franchises: [], entries: [] }, { contentPackId: "unused", questions: [] }, loaded.packs);
            ledgerStatus = { valid: baseline.errors.every((error) => !error.startsWith("Missing required Anime franchise assignment")), errors: baseline.errors.filter((error) => !error.startsWith("Missing required Anime franchise assignment")) };
        } catch (error) { ledgerStatus = { valid: false, errors: [error.message] }; }
        if (!ledgerStatus.valid) blockers.push(...ledgerStatus.errors.map((error) => `Anime ledger: ${error}`));
        if (!franchisePath) metadataError = "Anime publication requires --franchises with explicit franchise assignments.";
        else { try { metadataManifest = readJson(franchisePath, "Anime franchise manifest", fileSystem).value; } catch (error) { metadataError = error.message; } }
    }
    const newQuestions = (candidateQuestions ?? []).filter((question) => !duplicateIds.has(question?.id));
    const metadataIds = target === "fact-or-cap"
        ? new Set((metadataManifest?.classifications ?? []).map((item) => item?.questionId))
        : new Set((metadataManifest?.entries ?? []).map((item) => item?.questionId));
    const missingMetadata = newQuestions.map((question) => question?.id).filter((id) => !metadataIds.has(id));
    if (metadataError) warnings.push(metadataError);
    if (missingMetadata.length) warnings.push(`Required ledger metadata is missing for: ${missingMetadata.join(", ")}.`);
    if (exactDuplicates.length || normalizedDuplicates.length || sameIdIdentical.length) warnings.push("Duplicate matches require an explicit per-question decision before publication.");
    const report = {
        reportVersion: REPORT_VERSION,
        target,
        inputPath: path.resolve(inputPath),
        candidateSha256: sha256(sourceBytes),
        contentPackId: typeof contentPackId === "string" ? contentPackId : null,
        candidateQuestionCount: Array.isArray(candidateQuestions) ? candidateQuestions.length : 0,
        newQuestionIds: newQuestions.map((question) => question?.id ?? null),
        ledgerMetadataSha256: metadataManifest ? sha256(Buffer.from(JSON.stringify(metadataManifest))) : null,
        exactDuplicates,
        sameIdIdentical,
        conflictingIds,
        normalizedDuplicates,
        duplicateIds: [...duplicateIds].sort(),
        withinBatchDuplicates,
        invalidEntries: packValidation.errors,
        perQuestion,
        semanticReview: { status: "not-automated", note: "No semantic similarity system is used. Human review is required for claim-level overlap; normalized matches are not semantic determinations." },
        proposedDestination: typeof contentPackId === "string" ? path.join(contentDirectories[target] ?? "<invalid-target>", `${contentPackId}.json`) : null,
        ledger: { status: ledgerStatus.valid ? "valid-current-snapshot" : "invalid", missingMetadataQuestionIds: missingMetadata, errors: ledgerStatus.errors },
        blockers: [...new Set(blockers)],
        warnings: [...new Set(warnings)],
        publicationEligible: blockers.length === 0 && !metadataError && missingMetadata.length === 0 && newQuestions.length > 0
    };
    return { report, input, candidateQuestions, ledger, metadataManifest, ledgerStatus, packValidation, sourceBytes, targetRows, paths, fileSystem, contentDirectories };
}

function validateApproval(approval, review, selectedQuestions) {
    const errors = [];
    if (!isRecord(approval) || approval.approvalVersion !== APPROVAL_VERSION || !Array.isArray(approval.decisions)) return ["Approval file must use approvalVersion 1 and contain a decisions array."];
    if (approval.target !== review.report.target || approval.contentPackId !== review.report.contentPackId || approval.candidateSha256 !== review.report.candidateSha256) errors.push("Approval target, pack ID, or candidate SHA-256 does not match the reviewed candidate.");
    if (approval.ledgerMetadataSha256 !== review.report.ledgerMetadataSha256) errors.push("Approval ledger metadata SHA-256 does not match the reviewed metadata manifest.");
    if (typeof approval.reviewerId !== "string" || !approval.reviewerId.trim()) errors.push("Approval reviewerId is required.");
    if (typeof approval.approvedAt !== "string" || Number.isNaN(Date.parse(approval.approvedAt))) errors.push("Approval approvedAt must be a valid date/time.");
    if (typeof approval.rationale !== "string" || !approval.rationale.trim()) errors.push("Approval rationale is required.");
    const ids = new Set((review.candidateQuestions ?? []).map((question) => question?.id));
    const byId = new Map();
    for (const decision of approval.decisions) {
        if (!isRecord(decision) || !ids.has(decision.questionId)) { errors.push(`Approval has an unknown or invalid question decision: ${decision?.questionId ?? "missing ID"}.`); continue; }
        if (byId.has(decision.questionId)) errors.push(`Approval repeats decision for ${decision.questionId}.`);
        byId.set(decision.questionId, decision);
        const q = review.candidateQuestions.find(({ id }) => id === decision.questionId);
        const isExisting = (review.report.perQuestion.find((item) => item.questionId === q.id)?.idStatus ?? "new") === "same-id-identical";
        const hasDuplicate = (review.report.perQuestion.find((item) => item.questionId === q.id)?.duplicateMatches.length ?? 0) > 0;
        const allowed = isExisting ? ["already-published", "exclude"] : hasDuplicate ? ["publish-distinct", "exclude"] : ["publish", "exclude"];
        if (!allowed.includes(decision.outcome)) errors.push(`${q.id}: outcome must be one of ${allowed.join(", ")} for the reported matches.`);
        if (decision.outcome === "exclude" && (typeof decision.rationale !== "string" || !decision.rationale.trim())) errors.push(`${q.id}: exclusion requires a rationale.`);
        if (decision.outcome === "publish-distinct" && (typeof decision.rationale !== "string" || !decision.rationale.trim())) errors.push(`${q.id}: publishing a likely duplicate as distinct requires a rationale.`);
        if (isExisting && decision.outcome === "already-published" && !sameIdContent(q, review.targetRows.find(({ question }) => question.id === q.id)?.question ?? {})) errors.push(`${q.id}: already-published outcome does not match existing question content.`);
    }
    for (const id of ids) if (!byId.has(id)) errors.push(`Approval does not account for candidate question ${id}.`);
    if (!selectedQuestions.length) errors.push("Approval selects no new questions for publication.");
    return [...new Set(errors)].sort();
}

function planPublication({ review, approval, classificationManifest, animeFranchiseManifest, paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS }) {
    if (!review?.report || !review.input || !review.ledger) throw new Error("A valid review result is required.");
    if (review.report.blockers.length) throw new Error(`Publication is blocked:\n${review.report.blockers.map((item) => `- ${item}`).join("\n")}`);
    const candidates = review.candidateQuestions;
    if (!Array.isArray(candidates) || candidates.some((question) => !question || typeof question !== "object" || typeof question.id !== "string")) throw new Error("Publication candidate questions must all have valid question IDs.");
    const approvalRows = Array.isArray(approval?.decisions) ? approval.decisions.filter(isRecord) : [];
    const decisions = new Map(approvalRows.map((item) => [item.questionId, item]));
    const selected = candidates.filter((question) => ["publish", "publish-distinct"].includes(decisions.get(question.id)?.outcome));
    const approvalErrors = validateApproval(approval, review, selected);
    if (approvalErrors.length) throw new Error(`Publication approval is invalid:\n${approvalErrors.map((item) => `- ${item}`).join("\n")}`);
    if (review.report.ledger.errors.length) throw new Error("The existing ledger must reconcile before publication.");
    const pack = { ...review.input, questions: selected };
    const packValidation = validateQuestionPack(pack, review.report.proposedDestination);
    if (packValidation.errors.length) throw new Error(`Approved pack is invalid:\n${packValidation.errors.join("\n")}`);
    const destination = review.report.proposedDestination;
    const ledgerPath = review.report.target === "fact-or-cap" ? paths.generalLedger : paths.animeLedger;
    const ledgerRead = readJson(ledgerPath, "publication ledger", fileSystem);
    let updatedLedger;
    let ledgerReconciliation;
    if (review.report.target === "fact-or-cap") {
        if (!classificationManifest) throw new Error("General publication requires a classification manifest.");
        if (sha256(Buffer.from(JSON.stringify(classificationManifest))) !== review.report.ledgerMetadataSha256) throw new Error("General classification manifest changed after review.");
        const selectedIds = new Set(selected.map(({ id }) => id));
        const filtered = { ...classificationManifest, classifications: (classificationManifest.classifications ?? []).filter(({ questionId }) => selectedIds.has(questionId)) };
        const result = buildGeneralLedger(ledgerRead.value, filtered, pack, contentDirectories[review.report.target], fileSystem);
        if (!result.valid || !result.updatedLedger) throw new Error(`General ledger update is invalid:\n${result.errors.join("\n")}`);
        updatedLedger = result.updatedLedger;
        ledgerReconciliation = result.reconciliation;
    } else {
        if (!animeFranchiseManifest) throw new Error("Anime publication requires a franchise manifest.");
        if (sha256(Buffer.from(JSON.stringify(animeFranchiseManifest))) !== review.report.ledgerMetadataSha256) throw new Error("Anime franchise manifest changed after review.");
        const existingPacks = loadPublished(contentDirectories[review.report.target], fileSystem).packs;
        const result = makeAnimeLedgerUpdate(ledgerRead.value, animeFranchiseManifest, pack, existingPacks);
        if (!result.valid || !result.updatedLedger) throw new Error(`Anime ledger update is invalid:\n${result.errors.join("\n")}`);
        updatedLedger = result.updatedLedger;
        const postPublicationPacks = [...existingPacks, { fileName: `${pack.contentPackId}.json`, contentPackId: pack.contentPackId, questions: pack.questions }];
        const reconciliation = makeAnimeLedgerUpdate(updatedLedger, { manifestVersion: 1, franchises: [], entries: [] }, { contentPackId: "publication-reconciliation-check", questions: [] }, postPublicationPacks);
        const reconciliationErrors = reconciliation.errors.filter((item) => !item.startsWith("Missing required Anime franchise assignment"));
        if (reconciliationErrors.length) throw new Error(`Anime ledger does not reconcile after the proposed publication:\n${reconciliationErrors.join("\n")}`);
        ledgerReconciliation = { valid: true, questionCount: updatedLedger.bankSnapshot.questionCount, contentPackCount: updatedLedger.bankSnapshot.contentPackCount };
    }
    const ledgerBytes = Buffer.from(`${JSON.stringify(updatedLedger, null, 2)}\n`);
    const packBytes = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`);
    return { selected, candidates, pack, destination, ledgerPath, ledgerRead, updatedLedger, ledgerReconciliation, ledgerBytes, packBytes, packSha256: sha256(packBytes), ledgerSha256: sha256(ledgerBytes) };
}

module.exports = { APPROVAL_VERSION, DEFAULT_PATHS, REPORT_VERSION, TARGETS, ID_PATTERN, createReview, validateApproval, planPublication, sameIdContent, loadPublished, makeAnimeLedgerUpdate, readJson, packQuestions, sha256, isRecord, withPack };
