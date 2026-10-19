const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { buildGeneralTopicLedgerUpdate } = require("./generalTopicLedgerMaintenance");
const { compareGeneralTopicLedger } = require("./generalTopicLedgerReport");
const { duplicateKey, validateQuestionPack } = require("./questionLibrary");
const { inspectBatch } = require("./scripts/manage-question-batch");

const ROOT = path.resolve(__dirname);
const TARGETS = Object.freeze({
    "fact-or-cap": path.join(ROOT, "content", "general"),
    "fact-or-cap-anime": path.join(ROOT, "content", "anime")
});
const DEFAULT_PATHS = Object.freeze({
    generalLedger: path.join(ROOT, "research", "general-topic-ledger.json"),
    animeLedger: path.join(ROOT, "research", "anime-franchise-ledger.json"),
    incomingDirectory: path.join(ROOT, "incoming"),
    reportDirectory: path.join(ROOT, "research", "publication-reports"),
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

function makeAnimeLedgerUpdate(ledger, manifest, pack, existingPacks) {
    const errors = [];
    if (!isRecord(ledger) || ledger.ledgerVersion !== 1 || !Array.isArray(ledger.franchises) || !isRecord(ledger.bankSnapshot)) {
        return { valid: false, errors: ["Anime franchise ledger has an unsupported or malformed version-1 structure."], updatedLedger: null };
    }
    if (!isRecord(manifest) || manifest.manifestVersion !== 1 || !Array.isArray(manifest.entries) || !Array.isArray(manifest.franchises ?? [])) {
        return { valid: false, errors: ["Anime franchise manifest requires manifestVersion 1, franchises, and entries arrays."], updatedLedger: null };
    }
    const known = new Map();
    const membership = new Map();
    const aliases = new Map();
    const actual = new Map();
    for (const currentPack of existingPacks) {
        for (const question of currentPack.questions) {
            const key = `${currentPack.contentPackId}\0${question.id}`;
            if (actual.has(key)) errors.push(`Duplicate Anime question identity ${currentPack.contentPackId}/${question.id}.`);
            actual.set(key, currentPack.fileName);
        }
    }
    for (const franchise of ledger.franchises) {
        if (!isRecord(franchise) || typeof franchise.franchiseId !== "string" || !ID_PATTERN.test(franchise.franchiseId) || typeof franchise.displayName !== "string" || !Array.isArray(franchise.packMemberships) || !Array.isArray(franchise.aliases)) {
            errors.push("Anime ledger contains a malformed franchise record.");
            continue;
        }
        if (known.has(franchise.franchiseId)) errors.push(`Duplicate Anime franchise ID ${franchise.franchiseId}.`);
        known.set(franchise.franchiseId, franchise);
        for (const value of [franchise.franchiseId, franchise.displayName, ...franchise.aliases]) {
            if (typeof value !== "string" || !value.trim()) { errors.push(`Franchise ${franchise.franchiseId} has an empty alias or display name.`); continue; }
            const alias = value.trim().toLocaleLowerCase();
            if (aliases.has(alias) && aliases.get(alias) !== franchise.franchiseId) errors.push(`Anime franchise name or alias "${value}" is ambiguous.`);
            aliases.set(alias, franchise.franchiseId);
        }
        let questionCount = 0;
        for (const row of franchise.packMemberships) {
            if (!isRecord(row) || typeof row.contentPackId !== "string" || !Array.isArray(row.questionIds)) { errors.push(`Franchise ${franchise.franchiseId} has malformed pack membership.`); continue; }
            for (const questionId of row.questionIds) {
                questionCount += 1;
                const key = `${row.contentPackId}\0${questionId}`;
                if (membership.has(key)) errors.push(`Duplicate Anime ledger membership ${row.contentPackId}/${questionId}.`);
                membership.set(key, franchise.franchiseId);
            }
        }
        if (franchise.questionCount !== questionCount) errors.push(`Franchise ${franchise.franchiseId} has a stale questionCount.`);
    }
    for (const [identity, fileName] of actual) {
        if (!membership.has(identity)) errors.push(`Published Anime question is missing from franchise ledger: ${identity.replace("\0", "/")}.`);
        else {
            const [packId] = identity.split("\0");
            const franchiseId = membership.get(identity);
            if (!known.has(franchiseId)) errors.push(`Anime membership refers to missing franchise ${franchiseId}.`);
            if (path.basename(fileName, ".json") !== packId) errors.push(`Pack filename and ID disagree for ${packId}.`);
        }
    }
    for (const identity of membership.keys()) if (!actual.has(identity)) errors.push(`Anime ledger refers to unpublished question: ${identity.replace("\0", "/")}.`);
    const packIds = new Set([...actual.keys()].map((key) => key.split("\0")[0]));
    if (ledger.bankSnapshot.questionCount !== actual.size || ledger.bankSnapshot.contentPackCount !== packIds.size) errors.push("Anime ledger bankSnapshot does not match published packs.");

    const additionIds = new Set(pack.questions.map(({ id }) => id));
    const entriesById = new Map();
    for (const [index, entry] of manifest.entries.entries()) {
        if (!isRecord(entry) || !ID_PATTERN.test(entry.questionId ?? "") || !ID_PATTERN.test(entry.franchiseId ?? "")) { errors.push(`Anime franchise entry ${index + 1} requires valid questionId and franchiseId.`); continue; }
        if (entriesById.has(entry.questionId)) errors.push(`Duplicate Anime franchise entry for ${entry.questionId}.`);
        entriesById.set(entry.questionId, entry.franchiseId);
        if (!additionIds.has(entry.questionId)) errors.push(`Anime franchise entry refers to a question not being published: ${entry.questionId}.`);
    }
    for (const questionId of additionIds) if (!entriesById.has(questionId)) errors.push(`Missing required Anime franchise assignment for ${questionId}.`);

    const newFranchises = new Map();
    for (const [index, item] of (manifest.franchises ?? []).entries()) {
        if (!isRecord(item) || !ID_PATTERN.test(item.franchiseId ?? "") || typeof item.displayName !== "string" || !item.displayName.trim() || (item.aliases !== undefined && (!Array.isArray(item.aliases) || item.aliases.some((alias) => typeof alias !== "string" || !alias.trim())))) {
            errors.push(`New Anime franchise definition ${index + 1} requires a valid franchiseId, displayName, and optional string aliases.`);
            continue;
        }
        if (known.has(item.franchiseId) || newFranchises.has(item.franchiseId)) errors.push(`Anime franchise ${item.franchiseId} already exists or is declared twice.`);
        newFranchises.set(item.franchiseId, { franchiseId: item.franchiseId, displayName: item.displayName.trim(), aliases: [...new Set(item.aliases ?? [])] });
    }
    for (const franchiseId of entriesById.values()) if (!known.has(franchiseId) && !newFranchises.has(franchiseId)) errors.push(`New Anime franchise ${franchiseId} needs an explicit displayName definition.`);
    for (const [name, franchiseId] of newFranchises) {
        for (const value of [name, franchiseId.displayName, ...franchiseId.aliases]) {
            const key = value.toLocaleLowerCase();
            if (aliases.has(key) || [...newFranchises.values()].some((other) => other !== franchiseId && [other.franchiseId, other.displayName, ...other.aliases].some((alias) => alias.toLocaleLowerCase() === key))) errors.push(`Anime franchise name or alias "${value}" conflicts with another franchise.`);
        }
    }
    if (errors.length) return { valid: false, errors: [...new Set(errors)].sort(), updatedLedger: null };

    const updatedLedger = structuredClone(ledger);
    const franchiseById = new Map(updatedLedger.franchises.map((item) => [item.franchiseId, item]));
    for (const item of [...newFranchises.values()].sort((a, b) => a.franchiseId.localeCompare(b.franchiseId))) {
        franchiseById.set(item.franchiseId, { ...item, questionCount: 0, packMemberships: [] });
        updatedLedger.franchises.push(franchiseById.get(item.franchiseId));
    }
    for (const question of pack.questions) {
        const franchise = franchiseById.get(entriesById.get(question.id));
        let row = franchise.packMemberships.find((item) => item.contentPackId === pack.contentPackId);
        if (!row) { row = { contentPackId: pack.contentPackId, questionIds: [] }; franchise.packMemberships.push(row); }
        row.questionIds.push(question.id);
        row.questionIds.sort();
        franchise.questionCount += 1;
    }
    updatedLedger.bankSnapshot.questionCount += pack.questions.length;
    updatedLedger.bankSnapshot.contentPackCount += packIds.has(pack.contentPackId) ? 0 : 1;
    return { valid: true, errors: [], updatedLedger };
}

function buildGeneralLedger(ledger, manifest, pack, existingDirectory) {
    if (!isRecord(manifest) || manifest.manifestVersion !== 1 || !Array.isArray(manifest.classifications)) return { valid: false, errors: ["General publication requires a version-1 classification manifest."], updatedLedger: null };
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-publish-ledger-"));
    try {
        for (const fileName of fs.readdirSync(existingDirectory).filter((name) => name.endsWith(".json"))) fs.copyFileSync(path.join(existingDirectory, fileName), path.join(temp, fileName));
        fs.writeFileSync(path.join(temp, `${pack.contentPackId}.json`), `${JSON.stringify(pack, null, 2)}\n`);
        const result = buildGeneralTopicLedgerUpdate({ ledger, manifest, contentDirectory: temp });
        if (!result.valid || !result.updatedLedger) return result;
        const reconciliation = compareGeneralTopicLedger({ ledger: result.updatedLedger, contentDirectory: temp }).reconciliation;
        return { ...result, valid: reconciliation.valid, errors: reconciliation.errors, reconciliation };
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
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

function writeAndSync(filePath, contents, fileSystem = fs) {
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    const descriptor = fileSystem.openSync(filePath, "wx", 0o600);
    try { fileSystem.writeFileSync(descriptor, contents); fileSystem.fsyncSync(descriptor); }
    finally { fileSystem.closeSync(descriptor); }
}

function fileHash(filePath, fileSystem = fs) { return sha256(fileSystem.readFileSync(filePath)); }

function isInside(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function journalPath(paths) { return path.join(paths.transactionDirectory, "transaction.json"); }

function recoverPublication({ paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS } = {}) {
    const filePath = journalPath(paths);
    if (!fileSystem.existsSync(filePath)) {
        const transactionDirectoryExists = fileSystem.existsSync(paths.transactionDirectory);
        return { recovered: false, message: transactionDirectoryExists
            ? "No transaction journal exists, but the recovery directory is present; inspect it before retrying publication."
            : "No incomplete publication transaction." };
    }
    const journal = readJson(filePath, "publication recovery journal", fileSystem).value;
    if (!isRecord(journal) || journal.version !== 1 || !["prepared", "committed"].includes(journal.status) || !Array.isArray(journal.files) || journal.files.length !== 3) throw new Error("Invalid publication recovery journal; manual recovery is required.");
    if (!isRecord(journal.ledgerBackup) || typeof journal.ledgerBackup.path !== "string" || !/^[a-f0-9]{64}$/u.test(journal.ledgerBackup.sha256 ?? "") || !isInside(paths.transactionDirectory, journal.ledgerBackup.path)) throw new Error("Invalid publication ledger backup record; manual recovery is required.");
    const outputDirectories = [...Object.values(contentDirectories), paths.reportDirectory];
    const seenPaths = new Set();
    let replacementCount = 0;
    for (const item of journal.files) {
        if (!isRecord(item) || typeof item.path !== "string" || typeof item.tempPath !== "string" || !["new", "replace"].includes(item.kind) || !/^[a-f0-9]{64}$/u.test(item.nextSha256 ?? "")) throw new Error("Recovery journal contains a malformed file record; manual recovery is required.");
        const resolvedPath = path.resolve(item.path);
        if (seenPaths.has(resolvedPath)) throw new Error("Recovery journal repeats a destination path; manual recovery is required.");
        seenPaths.add(resolvedPath);
        const tempIsSibling = path.dirname(path.resolve(item.tempPath)) === path.dirname(resolvedPath) && path.basename(item.tempPath).startsWith(`.${path.basename(item.path)}.`) && path.basename(item.tempPath).endsWith(".tmp");
        if (!tempIsSibling) throw new Error("Recovery journal contains an invalid staged-file path; manual recovery is required.");
        if (item.kind === "replace") {
            replacementCount += 1;
            if (![paths.generalLedger, paths.animeLedger].some((ledgerPath) => path.resolve(ledgerPath) === resolvedPath) || !/^[a-f0-9]{64}$/u.test(item.previousSha256 ?? "")) throw new Error("Recovery journal contains an invalid ledger replacement; manual recovery is required.");
        } else if (!outputDirectories.some((root) => isInside(root, item.path))) throw new Error("Recovery journal contains a new output path outside publication directories; manual recovery is required.");
    }
    if (replacementCount !== 1) throw new Error("Recovery journal must contain exactly one ledger replacement; manual recovery is required.");
    if (journal.status === "committed") {
        for (const item of journal.files) if (!fileSystem.existsSync(item.path) || fileHash(item.path, fileSystem) !== item.nextSha256) throw new Error(`Committed publication artifact is missing or changed: ${item.path}.`);
    } else {
        for (const item of journal.files) {
            if (item.kind === "new") {
                if (fileSystem.existsSync(item.path)) {
                    if (fileHash(item.path, fileSystem) !== item.nextSha256) throw new Error(`Cannot safely roll back changed publication artifact ${item.path}.`);
                    fileSystem.unlinkSync(item.path);
                }
            } else if (fileSystem.existsSync(item.path)) {
                const current = fileHash(item.path, fileSystem);
                if (current === item.nextSha256) {
                    const backup = journal.ledgerBackup;
                    if (!backup || fileHash(backup.path, fileSystem) !== backup.sha256) throw new Error("Ledger backup is missing or changed; manual recovery is required.");
                    const tempRestore = `${item.path}.${crypto.randomUUID()}.restore`;
                    fileSystem.copyFileSync(backup.path, tempRestore);
                    fileSystem.renameSync(tempRestore, item.path);
                } else if (current !== item.previousSha256) throw new Error(`Cannot safely restore changed ledger ${item.path}.`);
            } else throw new Error(`Ledger disappeared during publication: ${item.path}.`);
        }
    }
    for (const item of journal.files) if (fileSystem.existsSync(item.tempPath)) fileSystem.unlinkSync(item.tempPath);
    if (journal.ledgerBackup?.path && fileSystem.existsSync(journal.ledgerBackup.path)) fileSystem.unlinkSync(journal.ledgerBackup.path);
    fileSystem.unlinkSync(filePath);
    try { fileSystem.rmdirSync(paths.transactionDirectory); } catch {}
    return { recovered: journal.status !== "committed", message: journal.status === "committed" ? "Completed publication transaction cleanup." : "Rolled back the interrupted publication." };
}

function applyTransaction({ fileWrites, ledgerPath, ledgerOldBytes, paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS }) {
    const txId = crypto.randomUUID();
    try { fileSystem.mkdirSync(paths.transactionDirectory); }
    catch (error) {
        if (error.code === "EEXIST") throw new Error("A publication transaction directory already exists; recover or inspect it before publishing.");
        throw error;
    }
    const staged = fileWrites.map((item) => {
        const tempPath = path.join(path.dirname(item.path), `.${path.basename(item.path)}.${txId}.tmp`);
        return { ...item, tempPath, nextSha256: sha256(item.contents) };
    });
    const ledgerBackupPath = path.join(paths.transactionDirectory, `${txId}.ledger.bak`);
    const journal = {
        version: 1,
        status: "prepared",
        files: staged.map(({ path: target, tempPath, kind, nextSha256 }) => ({ path: target, tempPath, kind, nextSha256, ...(kind === "replace" ? { previousSha256: sha256(ledgerOldBytes) } : {}) })),
        ledgerBackup: { path: ledgerBackupPath, sha256: sha256(ledgerOldBytes) }
    };
    try {
        // Journal all intended writes before staging any output. A crash during
        // staging is therefore recoverable and concurrent publishers cannot share
        // the exclusive transaction directory.
        writeAndSync(journalPath(paths), `${JSON.stringify(journal, null, 2)}\n`, fileSystem);
        for (const item of staged) {
            fileSystem.mkdirSync(path.dirname(item.path), { recursive: true });
            writeAndSync(item.tempPath, item.contents, fileSystem);
        }
        writeAndSync(ledgerBackupPath, ledgerOldBytes, fileSystem);
        for (const item of staged) {
            if (item.kind === "new") { fileSystem.linkSync(item.tempPath, item.path); fileSystem.unlinkSync(item.tempPath); }
            else fileSystem.renameSync(item.tempPath, item.path);
        }
        for (const item of journal.files) if (fileHash(item.path, fileSystem) !== item.nextSha256) throw new Error(`Post-write verification failed for ${item.path}.`);
        journal.status = "committed";
        const journalTemp = `${journalPath(paths)}.${txId}.tmp`;
        writeAndSync(journalTemp, `${JSON.stringify(journal, null, 2)}\n`, fileSystem);
        fileSystem.renameSync(journalTemp, journalPath(paths));
        recoverPublication({ paths, fileSystem, contentDirectories });
        return { hashes: Object.fromEntries(journal.files.map((item) => [item.path, item.nextSha256])) };
    } catch (error) {
        try {
            if (fileSystem.existsSync(journalPath(paths))) {
                const state = readJson(journalPath(paths), "publication recovery journal", fileSystem).value;
                const recovery = recoverPublication({ paths, fileSystem, contentDirectories });
                if (state?.status === "committed") return { hashes: Object.fromEntries(fileWrites.map((item) => [item.path, sha256(item.contents)])), recovery };
            } else {
                for (const item of staged) if (fileSystem.existsSync(item.tempPath)) fileSystem.unlinkSync(item.tempPath);
                try { fileSystem.rmdirSync(paths.transactionDirectory); } catch {}
            }
        } catch (rollbackError) {
            if (fileSystem.existsSync(journalPath(paths))) {
                try {
                    const state = readJson(journalPath(paths), "publication recovery journal", fileSystem).value;
                    if (state?.status === "committed") throw new Error(`Publication was committed, but transaction cleanup is incomplete (${rollbackError.message}); run the recovery command.`);
                } catch (stateError) {
                    if (stateError.message.startsWith("Publication was committed")) throw stateError;
                }
            }
            throw new Error(`Publication failed (${error.message}); recovery is required and the journal was preserved (${rollbackError.message}).`);
        }
        throw new Error(`Publication failed and was rolled back: ${error.message}`);
    }
}

function publishBatch({ review, approval, classificationManifest, animeFranchiseManifest, receiptPath: requestedReceiptPath, paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS }) {
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
        const result = buildGeneralLedger(ledgerRead.value, filtered, pack, contentDirectories[review.report.target]);
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
    const approvalHash = sha256(Buffer.from(JSON.stringify(approval)));
    const receiptPath = path.resolve(requestedReceiptPath ?? path.join(paths.reportDirectory, `${review.report.contentPackId}.json`));
    if (!isInside(paths.reportDirectory, receiptPath)) throw new Error(`Publication report must be stored under ${paths.reportDirectory}.`);
    if (fileSystem.existsSync(receiptPath)) throw new Error(`Publication receipt already exists: ${receiptPath}.`);
    const receipt = {
        reportVersion: REPORT_VERSION,
        status: "published",
        target: review.report.target,
        inputPath: review.report.inputPath,
        candidateSha256: review.report.candidateSha256,
        ledgerMetadataSha256: review.report.ledgerMetadataSha256,
        approvalSha256: approvalHash,
        reviewerId: approval.reviewerId,
        approvedAt: approval.approvedAt,
        rationale: approval.rationale,
        contentPackId: review.report.contentPackId,
        destination,
        packSha256: sha256(packBytes),
        ledgerPath,
        ledgerSha256: sha256(ledgerBytes),
        ledgerReconciliation: { status: "passed", ...ledgerReconciliation },
        candidateQuestionCount: candidates.length,
        publishedQuestionIds: selected.map(({ id }) => id),
        decisions: approval.decisions,
        reviewReport: review.report,
        warnings: review.report.warnings,
        semanticReview: review.report.semanticReview
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    applyTransaction({
        fileWrites: [
            { path: destination, contents: packBytes, kind: "new" },
            { path: ledgerPath, contents: ledgerBytes, kind: "replace" },
            { path: receiptPath, contents: receiptBytes, kind: "new" }
        ],
        ledgerPath,
        ledgerOldBytes: ledgerRead.bytes,
        paths,
        fileSystem,
        contentDirectories
    });
    return { receipt, receiptPath, pack, updatedLedger };
}

function cleanupEligibility({ inputPath, reportPath, paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS }) {
    const errors = [];
    const candidatePath = path.resolve(inputPath);
    if (!isInside(paths.incomingDirectory, candidatePath)) errors.push("Candidate cleanup is limited to files inside the Fact-or-Cap incoming directory.");
    if (typeof reportPath !== "string" || !isInside(paths.reportDirectory, path.resolve(reportPath))) errors.push("Candidate cleanup requires a publication receipt inside the publication report directory.");
    let receipt;
    try { receipt = readJson(reportPath, "publication receipt", fileSystem).value; } catch (error) { errors.push(error.message); }
    if (!isRecord(receipt) || receipt.status !== "published" || receipt.reportVersion !== REPORT_VERSION) errors.push("A completed version-1 publication receipt is required.");
    if (errors.length) return { eligible: false, errors, receipt };
    let candidate;
    let bytes;
    try {
        if (fileSystem.lstatSync(candidatePath).isSymbolicLink()) errors.push("Candidate cleanup does not follow symbolic links.");
        ({ value: candidate, bytes } = readJson(candidatePath, "candidate", fileSystem));
    } catch (error) { errors.push(error.message); }
    if (errors.length) return { eligible: false, errors, receipt };
    if (sha256(bytes) !== receipt.candidateSha256 || path.resolve(receipt.inputPath) !== candidatePath) errors.push("Candidate bytes or path no longer match the publication receipt.");
    const targetDirectory = contentDirectories[receipt.target];
    const questions = packQuestions(candidate);
    if (!Array.isArray(questions) || questions.length !== receipt.candidateQuestionCount) errors.push("Candidate question set no longer matches the publication receipt.");
    if (Array.isArray(questions) && new Set(questions.map(({ id }) => id)).size !== questions.length) errors.push("Candidate contains duplicate question IDs and cannot be safely cleaned up.");
    if (!Object.hasOwn(contentDirectories, receipt.target)) errors.push("Publication receipt has an unknown content target.");
    if (!Array.isArray(receipt.publishedQuestionIds) || new Set(receipt.publishedQuestionIds).size !== receipt.publishedQuestionIds.length) errors.push("Publication receipt has an invalid published question ID list.");
    if (!Array.isArray(receipt.decisions) || receipt.decisions.length !== (questions?.length ?? 0)) errors.push("Publication receipt does not contain exactly one decision per candidate question.");
    const receiptPublishedIds = Array.isArray(receipt.publishedQuestionIds) ? receipt.publishedQuestionIds : [];
    const destinations = questions?.filter((question) => receiptPublishedIds.includes(question.id)) ?? [];
    if (destinations.length !== receiptPublishedIds.length) errors.push("Receipt does not account for every published candidate question.");
    const destinationPath = typeof receipt.destination === "string" ? receipt.destination : "";
    if (!targetDirectory || !destinationPath || !isInside(targetDirectory, destinationPath) || path.basename(destinationPath) !== `${receipt.contentPackId}.json` || !fileSystem.existsSync(destinationPath)) errors.push("Published destination is missing or outside the target bank.");
    else {
        try {
            const packBytes = fileSystem.readFileSync(destinationPath);
            if (sha256(packBytes) !== receipt.packSha256) errors.push("Published pack changed after the receipt was recorded.");
            const pack = JSON.parse(packBytes.toString("utf8"));
            const packValidation = validateQuestionPack(pack, destinationPath);
            errors.push(...packValidation.errors.map((item) => `Published pack validation: ${item}`));
            const questionsInPack = packQuestions(pack) ?? [];
            const ids = new Set(questionsInPack.map(({ id }) => id));
            if (pack.contentPackId !== receipt.contentPackId || ids.size !== receiptPublishedIds.length || [...ids].some((id) => !receiptPublishedIds.includes(id))) errors.push("Published pack contents do not exactly match the receipt question IDs.");
            const questionsById = new Map(questionsInPack.map((question) => [question.id, question]));
            for (const question of questions ?? []) if (receiptPublishedIds.includes(question.id) && !sameIdContent(question, questionsById.get(question.id) ?? {})) errors.push(`Published question ${question.id} differs from the candidate content.`);
        } catch (error) { errors.push(`Published pack verification failed: ${error.message}`); }
    }
    const decisionRows = Array.isArray(receipt.decisions) ? receipt.decisions.filter(isRecord) : [];
    const decisions = new Map(decisionRows.map(({ questionId, outcome }) => [questionId, outcome]));
    if (decisions.size !== (receipt.decisions?.length ?? 0)) errors.push("Publication receipt repeats a candidate question decision.");
    const targetPacks = targetDirectory ? loadPublished(targetDirectory, fileSystem).packs : [];
    const publishedById = new Map(targetPacks.flatMap((pack) => pack.questions.map((question) => [question.id, { question, pack }])));
    const publishedIds = new Set(receipt.publishedQuestionIds);
    for (const question of questions ?? []) {
        const outcome = decisions.get(question.id);
        if (!outcome) { errors.push(`Candidate question ${question.id} has no recorded publication disposition.`); continue; }
        if (outcome === "exclude") errors.push(`Candidate question ${question.id} was excluded and remains unpublished; retain the candidate or create and review a verified split.`);
        if (["publish", "publish-distinct"].includes(outcome) && !publishedIds.has(question.id)) errors.push(`Approved question ${question.id} is absent from the publication receipt.`);
        if (!["publish", "publish-distinct", "already-published", "exclude"].includes(outcome)) errors.push(`Candidate question ${question.id} has an unsupported recorded disposition.`);
        if (["already-published", "exclude"].includes(outcome) && publishedIds.has(question.id)) errors.push(`Question ${question.id} has an unpublished disposition but appears in the new pack receipt.`);
        if (outcome === "already-published") {
            const existing = publishedById.get(question.id)?.question;
            if (!existing || !sameIdContent(question, existing)) errors.push(`Question ${question.id} was marked already-published but no identical question exists in the target bank.`);
        }
    }
    try {
        const ledgerPath = receipt.target === "fact-or-cap" ? paths.generalLedger : paths.animeLedger;
        const ledgerBytes = fileSystem.readFileSync(ledgerPath);
        if (sha256(ledgerBytes) !== receipt.ledgerSha256) errors.push("The ledger has changed since publication; reconcile it before cleanup.");
        if (receipt.target === "fact-or-cap") {
            const reconciliation = compareGeneralTopicLedger({ ledger: JSON.parse(ledgerBytes.toString("utf8")), contentDirectory: targetDirectory, fileSystem }).reconciliation;
            if (!reconciliation.valid) errors.push(...reconciliation.errors.map((item) => `Ledger reconciliation: ${item}`));
        } else {
            const ledger = JSON.parse(ledgerBytes.toString("utf8"));
            const existing = loadPublished(targetDirectory, fileSystem).packs;
            const check = makeAnimeLedgerUpdate(ledger, { manifestVersion: 1, franchises: [], entries: [] }, { contentPackId: "unused", questions: [] }, existing);
            const currentErrors = check.errors.filter((item) => !item.startsWith("Missing required Anime franchise assignment"));
            if (currentErrors.length) errors.push(...currentErrors.map((item) => `Anime ledger reconciliation: ${item}`));
        }
    } catch (error) { errors.push(`Ledger verification failed: ${error.message}`); }
    return { eligible: errors.length === 0, errors: [...new Set(errors)], receipt };
}

function cleanupCandidate(options) {
    const result = cleanupEligibility(options);
    if (!result.eligible) throw new Error(`Candidate is not eligible for cleanup:\n${result.errors.map((item) => `- ${item}`).join("\n")}`);
    if (options.confirmPackId !== result.receipt.contentPackId) throw new Error(`Cleanup requires --confirm-delete ${result.receipt.contentPackId}.`);
    const fileSystem = options.fileSystem ?? fs;
    const candidatePath = path.resolve(options.inputPath);
    if (sha256(fileSystem.readFileSync(candidatePath)) !== result.receipt.candidateSha256) throw new Error("Candidate changed during cleanup verification; retain it and review again.");
    fileSystem.unlinkSync(candidatePath);
    return { deleted: path.resolve(options.inputPath), contentPackId: result.receipt.contentPackId };
}

function formatReview(report) {
    const lines = [
        `Target: ${report.target}`,
        `Candidate: ${report.inputPath}`,
        `Questions: ${report.candidateQuestionCount}`,
        `Proposed pack: ${report.contentPackId ?? "unavailable"}`,
        `Destination: ${report.proposedDestination ?? "unavailable"}`,
        `New questions: ${report.newQuestionIds.length} (${report.newQuestionIds.join(", ") || "none"})`,
        `Same ID, identical: ${report.sameIdIdentical.length}`,
        `Conflicting IDs: ${report.conflictingIds.length}`,
        `Exact prompt/answer matches: ${report.exactDuplicates.length}`,
        `Normalized prompt/answer matches: ${report.normalizedDuplicates.length}`,
        `Within-batch duplicate pairs: ${report.withinBatchDuplicates.length}`,
        `Semantic comparison: not automated; human review required.`,
        `Ledger: ${report.ledger.status}; missing candidate metadata ${report.ledger.missingMetadataQuestionIds.length}`,
        `Publication eligible after approval: ${report.publicationEligible ? "yes" : "no"}`
    ];
    if (report.blockers.length) lines.push("Blocking errors:", ...report.blockers.map((item) => `- ${item}`));
    else lines.push("Blocking errors: none");
    if (report.warnings.length) lines.push("Warnings:", ...report.warnings.map((item) => `- ${item}`));
    else lines.push("Warnings: none");
    for (const item of [...report.exactDuplicates, ...report.normalizedDuplicates, ...report.sameIdIdentical, ...report.conflictingIds]) lines.push(`  ${item.candidateId} ↔ ${item.existingPackId}/${item.existingQuestionId ?? item.candidateId} (${item.existingPackFile})`);
    return lines.join("\n");
}

module.exports = {
    APPROVAL_VERSION,
    DEFAULT_PATHS,
    REPORT_VERSION,
    TARGETS,
    applyTransaction,
    cleanupCandidate,
    cleanupEligibility,
    createReview,
    formatReview,
    makeAnimeLedgerUpdate,
    publishBatch,
    recoverPublication,
    sameIdContent,
    sha256,
    validateApproval
};
