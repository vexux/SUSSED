const fs = require("node:fs");
const path = require("node:path");
const { compareGeneralTopicLedger } = require("./generalTopicLedgerReport");
const { validateQuestionPack } = require("./questionLibrary");
const { APPROVAL_VERSION, DEFAULT_PATHS, REPORT_VERSION, TARGETS, ID_PATTERN, createReview, validateApproval, planPublication, sameIdContent, loadPublished, makeAnimeLedgerUpdate, readJson, packQuestions, sha256, isRecord } = require("./publicationPlan");

const { applyTransaction, recoverPublication } = require("./publicationTransaction");

function isInside(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function publishBatch({ tracked, check, checkApplied, sourcePath, review, approval, classificationManifest, animeFranchiseManifest, receiptPath: requestedReceiptPath, paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS }) {
    const { selected, candidates, pack, destination, ledgerPath, ledgerRead, updatedLedger, ledgerReconciliation, ledgerBytes, packBytes } = planPublication({ review, approval, classificationManifest, animeFranchiseManifest, paths, fileSystem, contentDirectories });
    const approvalHash = sha256(Buffer.from(JSON.stringify(approval)));
    const receiptPath = path.resolve(requestedReceiptPath ?? path.join(paths.temporaryEvidenceDirectory, `${review.report.contentPackId}.json`));
    if (!isInside(paths.temporaryEvidenceDirectory, receiptPath)) throw new Error(`Temporary publication receipt must be stored under ${paths.temporaryEvidenceDirectory}.`);
    if (fileSystem.existsSync(receiptPath)) throw new Error(`Publication receipt already exists: ${receiptPath}.`);
    const receipt = {
        reportVersion: REPORT_VERSION,
        status: "published",
        ...(tracked ? { trackedSha256: sha256(Buffer.from(JSON.stringify(tracked, null, 2) + "\n")) } : {}),
        target: review.report.target,
        inputPath: sourcePath ?? review.report.inputPath,
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
        check, checkApplied, transactionId: tracked?.transactionId,
        fileWrites: [
            { path: destination, contents: packBytes, kind: "new" },
            { path: ledgerPath, contents: ledgerBytes, kind: "replace" },
            { path: receiptPath, contents: receiptBytes, kind: "new" },
            ...(tracked ? [{ path: path.join(paths.trackedReceiptDirectory, tracked.transactionId + ".json"), contents: Buffer.from(JSON.stringify(tracked, null, 2) + "\n"), kind: "new" }] : [])
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
    if (typeof reportPath !== "string" || !isInside(paths.temporaryEvidenceDirectory, path.resolve(reportPath))) errors.push("Candidate cleanup requires a receipt inside the temporary publication evidence directory.");
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
    const paths = options.paths ?? DEFAULT_PATHS;
    const candidatePath = path.resolve(options.inputPath);
    if (sha256(fileSystem.readFileSync(candidatePath)) !== result.receipt.candidateSha256) throw new Error("Candidate changed during cleanup verification; retain it and review again.");
    fileSystem.unlinkSync(candidatePath);
    let deletedReceipt = false;
    try {
        fileSystem.unlinkSync(path.resolve(options.reportPath));
        deletedReceipt = true;
        try { fileSystem.rmdirSync(paths.temporaryEvidenceDirectory); } catch {}
    } catch {}
    return { deleted: candidatePath, contentPackId: result.receipt.contentPackId, deletedReceipt };
}

function cleanupFranchiseManifestEligibility({ manifestPath, confirmPackId, paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS }) {
    const errors = [];
    const manifestFile = path.resolve(manifestPath ?? "");
    const fileName = path.basename(manifestFile);
    const inferredPackId = fileName.endsWith("-franchises.json") ? fileName.slice(0, -"-franchises.json".length) : "";
    const contentPackId = confirmPackId ?? inferredPackId;
    const expectedManifestPath = path.resolve(paths.incomingDirectory, `${contentPackId}-franchises.json`);
    if (!ID_PATTERN.test(contentPackId)) errors.push("A valid content pack ID is required to clean up a franchise manifest.");
    if (manifestFile !== expectedManifestPath) errors.push("Franchise manifest cleanup is limited to the matching <contentPackId>-franchises.json file inside incoming.");
    if (!Object.hasOwn(contentDirectories, "fact-or-cap-anime")) errors.push("Anime content directory is not configured.");
    const candidatePath = path.resolve(paths.incomingDirectory, `${contentPackId}-candidate.json`);
    if (fileSystem.existsSync(candidatePath)) errors.push("The matching candidate file must be removed by guarded publication cleanup before its franchise manifest.");
    if (fileSystem.existsSync(path.join(paths.transactionDirectory, "transaction.json"))) errors.push("An unfinished publication transaction prevents franchise manifest cleanup.");
    if (errors.length) return { eligible: false, errors: [...new Set(errors)], contentPackId };

    let manifest;
    let manifestBytes;
    try {
        if (fileSystem.lstatSync(manifestFile).isSymbolicLink()) errors.push("Franchise manifest cleanup does not follow symbolic links.");
        ({ value: manifest, bytes: manifestBytes } = readJson(manifestFile, "Anime franchise manifest", fileSystem));
    } catch (error) { errors.push(error.message); }
    if (!isRecord(manifest) || manifest.manifestVersion !== 1 || !Array.isArray(manifest.entries) || !Array.isArray(manifest.franchises)) {
        errors.push("Franchise manifest must use manifestVersion 1 with franchises and entries arrays.");
    }
    if (errors.length) return { eligible: false, errors: [...new Set(errors)], contentPackId };

    const targetDirectory = contentDirectories["fact-or-cap-anime"];
    const destination = path.resolve(targetDirectory, `${contentPackId}.json`);
    let publishedPack;
    try {
        if (fileSystem.lstatSync(destination).isSymbolicLink()) errors.push("Published pack verification does not follow symbolic links.");
        publishedPack = JSON.parse(fileSystem.readFileSync(destination, "utf8"));
    } catch (error) { errors.push(`Published Anime pack is unavailable: ${error.message}`); }
    if (!isRecord(publishedPack) || publishedPack.contentPackId !== contentPackId || !Array.isArray(publishedPack.questions)) {
        errors.push(`Published Anime pack ${contentPackId} is missing or does not match the manifest filename.`);
    }
    if (publishedPack) errors.push(...validateQuestionPack(publishedPack, destination).errors.map((item) => `Published pack validation: ${item}`));

    let loaded;
    try {
        loaded = loadPublished(targetDirectory, fileSystem);
        errors.push(...loaded.errors.map((item) => `Published Anime library: ${item}`));
        const matches = loaded.packs.filter((pack) => pack.contentPackId === contentPackId);
        if (matches.length !== 1 || matches[0]?.fileName !== `${contentPackId}.json`) errors.push(`Published Anime pack identity ${contentPackId} is missing, duplicated, or has a mismatched filename.`);
    } catch (error) { errors.push(`Unable to inspect published Anime library: ${error.message}`); }

    let ledger;
    try { ledger = readJson(paths.animeLedger, "Anime franchise ledger", fileSystem).value; }
    catch (error) { errors.push(error.message); }
    if (ledger && loaded && Array.isArray(ledger.franchises)) {
        const reconciliation = makeAnimeLedgerUpdate(
            ledger,
            { manifestVersion: 1, franchises: [], entries: [] },
            { contentPackId: "manifest-cleanup-reconciliation", questions: [] },
            loaded.packs
        );
        if (!reconciliation.valid) errors.push(...reconciliation.errors.map((item) => `Anime ledger reconciliation: ${item}`));
    }

    if (manifest && Array.isArray(manifest.entries) && Array.isArray(manifest.franchises) && Array.isArray(publishedPack?.questions) && Array.isArray(ledger?.franchises)) {
        const questions = publishedPack.questions;
        const questionIds = new Set(questions.map(({ id }) => id));
        const entryByQuestionId = new Map();
        for (const [index, entry] of manifest.entries.entries()) {
            if (!isRecord(entry) || !ID_PATTERN.test(entry.questionId ?? "") || !ID_PATTERN.test(entry.franchiseId ?? "")) {
                errors.push(`Franchise manifest entry ${index + 1} has an invalid question or franchise ID.`);
                continue;
            }
            if (entryByQuestionId.has(entry.questionId)) errors.push(`Franchise manifest repeats question ${entry.questionId}.`);
            entryByQuestionId.set(entry.questionId, entry.franchiseId);
            if (!questionIds.has(entry.questionId)) errors.push(`Franchise manifest refers to unpublished question ${entry.questionId}.`);
        }
        for (const questionId of questionIds) if (!entryByQuestionId.has(questionId)) errors.push(`Franchise manifest is missing published question ${questionId}.`);
        if (entryByQuestionId.size !== questionIds.size) errors.push("Franchise manifest entries do not exactly match the published pack question set.");

        const ledgerById = new Map(ledger.franchises.map((franchise) => [franchise.franchiseId, franchise]));
        const ledgerAssignments = new Map();
        for (const franchise of ledger.franchises) {
            for (const row of franchise.packMemberships ?? []) {
                if (row.contentPackId !== contentPackId) continue;
                for (const questionId of row.questionIds ?? []) {
                    if (ledgerAssignments.has(questionId)) errors.push(`Ledger has multiple franchise assignments for ${questionId} in ${contentPackId}.`);
                    ledgerAssignments.set(questionId, franchise.franchiseId);
                }
            }
        }
        for (const [questionId, franchiseId] of entryByQuestionId) {
            if (ledgerAssignments.get(questionId) !== franchiseId) errors.push(`Franchise manifest assignment for ${questionId} does not match the reconciled ledger.`);
        }
        if (ledgerAssignments.size !== questionIds.size) errors.push("Ledger membership does not exactly match the published pack question set.");

        const definitions = new Map();
        for (const [index, franchise] of manifest.franchises.entries()) {
            if (!isRecord(franchise) || !ID_PATTERN.test(franchise.franchiseId ?? "") || typeof franchise.displayName !== "string" || !franchise.displayName.trim() || (franchise.aliases !== undefined && (!Array.isArray(franchise.aliases) || franchise.aliases.some((alias) => typeof alias !== "string" || !alias.trim())))) {
                errors.push(`Franchise definition ${index + 1} is malformed.`);
                continue;
            }
            if (definitions.has(franchise.franchiseId)) errors.push(`Franchise manifest repeats definition ${franchise.franchiseId}.`);
            definitions.set(franchise.franchiseId, franchise);
        }
        const usedFranchiseIds = new Set(entryByQuestionId.values());
        for (const [franchiseId, definition] of definitions) {
            const existing = ledgerById.get(franchiseId);
            if (!existing || existing.displayName !== definition.displayName.trim() || JSON.stringify([...(existing.aliases ?? [])].sort()) !== JSON.stringify([...(definition.aliases ?? [])].sort())) {
                errors.push(`Franchise definition ${franchiseId} does not match the published ledger.`);
            }
            if (!usedFranchiseIds.has(franchiseId)) errors.push(`Franchise definition ${franchiseId} is unused by this batch.`);
        }
        for (const franchiseId of usedFranchiseIds) if (!ledgerById.has(franchiseId)) errors.push(`Published ledger is missing franchise ${franchiseId}.`);
        for (const franchiseId of usedFranchiseIds) {
            const franchise = ledgerById.get(franchiseId);
            const appearedInEarlierPack = franchise?.packMemberships?.some((row) => row.contentPackId !== contentPackId) ?? false;
            if (appearedInEarlierPack && definitions.has(franchiseId)) errors.push(`Franchise ${franchiseId} is already present in the ledger and must not be declared as new.`);
            if (!appearedInEarlierPack && !definitions.has(franchiseId)) errors.push(`New franchise ${franchiseId} is missing its manifest definition.`);
        }
    }

    return {
        eligible: errors.length === 0,
        errors: [...new Set(errors)],
        contentPackId,
        manifestPath: manifestFile,
        manifestSha256: manifestBytes ? sha256(manifestBytes) : null
    };
}

function cleanupFranchiseManifest({ manifestPath, confirmPackId, paths = DEFAULT_PATHS, fileSystem = fs, contentDirectories = TARGETS }) {
    const result = cleanupFranchiseManifestEligibility({ manifestPath, confirmPackId, paths, fileSystem, contentDirectories });
    if (!result.eligible) throw new Error(`Franchise manifest is not eligible for cleanup:\n${result.errors.map((item) => `- ${item}`).join("\n")}`);
    if (confirmPackId !== result.contentPackId) throw new Error(`Cleanup requires --confirm-delete ${result.contentPackId}.`);
    const manifestPathResolved = path.resolve(manifestPath);
    if (sha256(fileSystem.readFileSync(manifestPathResolved)) !== result.manifestSha256) throw new Error("Franchise manifest changed during cleanup verification; retain it and review again.");
    fileSystem.unlinkSync(manifestPathResolved);
    return { deleted: manifestPathResolved, contentPackId: result.contentPackId };
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
    cleanupFranchiseManifest,
    cleanupFranchiseManifestEligibility,
    createReview,
    formatReview,
    makeAnimeLedgerUpdate,
    publishBatch,
    recoverPublication,
    sameIdContent,
    sha256,
    validateApproval
};
