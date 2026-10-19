const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
    duplicateKey,
    normalizeForComparison,
    validateQuestionLibrary
} = require("../questionLibrary");

const CONTENT_ROOT = path.resolve(__dirname, "..");
const TARGETS = Object.freeze({
    "fact-or-cap": path.join(CONTENT_ROOT, "content", "general"),
    "fact-or-cap-anime": path.join(CONTENT_ROOT, "content", "anime")
});

function readPacks(directory, fileSystem = fs) {
    return fileSystem.readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .map((fileName) => {
            const fullPath = path.join(directory, fileName);
            let data;
            try {
                data = JSON.parse(fileSystem.readFileSync(fullPath, "utf8"));
            } catch (error) {
                throw new Error(`Unable to read ${fullPath}: ${error.message}`);
            }
            return { fileName: fullPath, data };
        });
}

function getPackFileName(batch) {
    const packId = batch && !Array.isArray(batch) ? batch.contentPackId : null;
    if (
        typeof packId !== "string" ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(packId)
    ) {
        throw new Error(
            "The batch must have a top-level contentPackId using lowercase letters, numbers, and hyphens."
        );
    }
    return `${packId}.json`;
}

function collectDuplicates(existingPacks, candidate, {
    gameId,
    scope = "target-bank",
    includeCandidateDuplicates = true
} = {}) {
    const existingIds = new Set();
    const existingContent = new Map();
    for (const { data, fileName } of existingPacks) {
        const questions = Array.isArray(data) ? data : data?.questions;
        if (!Array.isArray(questions)) {
            continue;
        }
        for (const question of questions) {
            if (typeof question?.id === "string") {
                existingIds.add(question.id);
            }
            if (
                typeof question?.text === "string" &&
                typeof question?.correctCompletion === "string"
            ) {
                const key = duplicateKey(question);
                const matches = existingContent.get(key) ?? [];
                matches.push({
                    gameId: data?.gameId ?? gameId,
                    contentPackId: question.contentPackId ?? data?.contentPackId ??
                        (typeof fileName === "string" ? path.basename(fileName, ".json") : null),
                    existingQuestionId: question.id ?? null,
                    scope
                });
                existingContent.set(key, matches);
            }
        }
    }

    const ids = new Set();
    const duplicateIds = new Set();
    const existingDuplicateIds = new Set();
    const content = new Map();
    const duplicateContent = new Map();
    const duplicateMatches = [];
    for (const question of candidate.questions ?? []) {
        if (!question || typeof question !== "object") {
            continue;
        }
        if (typeof question.id === "string") {
            if (existingIds.has(question.id) || ids.has(question.id)) {
                duplicateIds.add(question.id);
            }
            if (existingIds.has(question.id)) {
                existingDuplicateIds.add(question.id);
            }
            ids.add(question.id);
        }
        if (
            typeof question.text === "string" &&
            typeof question.correctCompletion === "string"
        ) {
            const key = duplicateKey(question);
            const matches = [
                ...(existingContent.get(key) ?? []),
                ...(includeCandidateDuplicates ? content.get(key) ?? [] : [])
            ];
            if (matches.length > 0) {
                const contentLabel = `${normalizeForComparison(question.text)} | ${normalizeForComparison(question.correctCompletion)}`;
                duplicateContent.set(contentLabel, contentLabel);
                for (const match of matches) {
                    duplicateMatches.push({
                        candidateId: question.id ?? null,
                        ...match,
                        ...(match.existingQuestionId === null
                            ? { existingQuestionId: question.id ?? null }
                            : {})
                    });
                }
            }
            const batchMatches = content.get(key) ?? [];
            batchMatches.push({
                gameId,
                contentPackId: candidate.contentPackId ?? null,
                existingQuestionId: question.id ?? null,
                scope,
                matchSource: "candidate-batch"
            });
            content.set(key, batchMatches);
        }
    }
    return {
        duplicateIds: [...duplicateIds].sort(),
        existingDuplicateIds: [...existingDuplicateIds].sort(),
        duplicateContent: [...duplicateContent.keys()].sort(),
        duplicateMatches
    };
}

function inspectBatch({ target, inputPath, fileSystem = fs, contentDirectories = TARGETS }) {
    if (!Object.hasOwn(contentDirectories, target)) {
        throw new Error(`Unknown target "${target}". Select one of: ${Object.keys(contentDirectories).join(", ")}.`);
    }
    const directory = contentDirectories[target];
    const absoluteInput = path.resolve(inputPath);
    let candidate;
    try {
        candidate = JSON.parse(fileSystem.readFileSync(absoluteInput, "utf8"));
    } catch (error) {
        throw new Error(`Unable to read candidate batch ${absoluteInput}: ${error.message}`);
    }
    const destinationName = getPackFileName(candidate);
    const existingPacks = readPacks(directory, fileSystem);
    const otherLibraryPacks = Object.entries(contentDirectories)
        .filter(([libraryId]) => libraryId !== target)
        .flatMap(([gameId, libraryDirectory]) =>
            fileSystem.existsSync(libraryDirectory)
                ? readPacks(libraryDirectory, fileSystem).map((pack) => ({
                    ...pack,
                    data: Array.isArray(pack.data)
                        ? { questions: pack.data, gameId }
                        : { ...pack.data, gameId }
                }))
                : []
        );
    const candidateValidation = validateQuestionLibrary([
        ...existingPacks,
        { fileName: absoluteInput, data: candidate }
    ]);
    const conflicts = collectDuplicates(existingPacks, candidate, { gameId: target });
    const crossLibraryDuplicates = collectDuplicates(otherLibraryPacks, candidate, {
        scope: "cross-bank",
        includeCandidateDuplicates: false
    });
    const crossLibraryConflicts = crossLibraryDuplicates.existingDuplicateIds;
    const crossLibraryMatches = crossLibraryDuplicates.duplicateMatches;
    const duplicateMatches = [...conflicts.duplicateMatches, ...crossLibraryMatches];
    const duplicateContent = [...new Set([
        ...conflicts.duplicateContent,
        ...crossLibraryDuplicates.duplicateContent
    ])].sort();
    const errors = [...candidateValidation.errors];
    const questions = Array.isArray(candidate) ? candidate : candidate?.questions;
    const candidatePackId = Array.isArray(candidate) ? null : candidate?.contentPackId;
    if (Array.isArray(questions) && questions.length === 0) {
        errors.push("The candidate batch must contain at least one question.");
    }
    if (Array.isArray(questions)) {
        for (const question of questions) {
            if (
                question &&
                typeof question === "object" &&
                typeof question.contentPackId === "string" &&
                question.contentPackId !== candidatePackId
            ) {
                errors.push(
                    `Question "${question.id ?? "<unknown>"}" contentPackId "${question.contentPackId}" does not match batch contentPackId "${candidatePackId}".`
                );
            }
            if (
                question &&
                typeof question === "object" &&
                typeof question.id === "string" &&
                !/^[a-z0-9][a-z0-9-]{0,95}$/u.test(question.id)
            ) {
                errors.push(
                    `Question ID "${question.id}" must use lowercase letters, numbers, and hyphens (maximum 96 characters).`
                );
            }
        }
    }
    const missingSourceWarnings = candidateValidation.warnings.filter(
        (warning) =>
            warning.startsWith(`${absoluteInput}:`) &&
            warning.includes("is missing source information.")
    );
    if (missingSourceWarnings.length > 0) {
        errors.push(
            `Every imported question must include sourceName and sourceUrl: ${missingSourceWarnings.join("; ")}`
        );
    }
    if (conflicts.duplicateIds.length > 0) {
        errors.push(`Duplicate question IDs: ${conflicts.duplicateIds.join(", ")}`);
    }
    if (crossLibraryConflicts.length > 0) {
        errors.push(`Question IDs already used in another registered library: ${crossLibraryConflicts.join(", ")}`);
    }
    const destination = path.join(directory, destinationName);
    if (fileSystem.existsSync(destination)) {
        errors.push(`A content pack already exists at ${destination}. Imports never overwrite packs.`);
    }
    return {
        target,
        inputPath: absoluteInput,
        directory,
        destination,
        destinationName,
        questions: Array.isArray(questions) ? questions : [],
        errors,
        warnings: candidateValidation.warnings,
        duplicateIds: conflicts.duplicateIds,
        crossLibraryConflicts,
        duplicateContent,
        duplicateMatches,
        canImport: errors.length === 0
    };
}

function writeNewPackAtomically(destination, contents, fileSystem = fs) {
    const temporaryPath = path.join(
        path.dirname(destination),
        `.${path.basename(destination)}.${randomUUID()}.tmp`
    );
    let fileDescriptor;
    try {
        fileDescriptor = fileSystem.openSync(temporaryPath, "wx", 0o600);
        fileSystem.writeFileSync(fileDescriptor, contents, "utf8");
        fileSystem.fsyncSync(fileDescriptor);
        fileSystem.closeSync(fileDescriptor);
        fileDescriptor = undefined;

        fileSystem.linkSync(temporaryPath, destination);
    } catch (error) {
        const cleanupErrors = [];
        if (fileDescriptor !== undefined) {
            try {
                fileSystem.closeSync(fileDescriptor);
            } catch (cleanupError) {
                cleanupErrors.push(cleanupError.message);
            }
        }
        try {
            if (fileSystem.existsSync(temporaryPath)) {
                fileSystem.unlinkSync(temporaryPath);
            }
        } catch (cleanupError) {
            cleanupErrors.push(cleanupError.message);
        }
        if (cleanupErrors.length > 0) {
            throw new Error(`Import failed (${error.message}); cleanup failed: ${cleanupErrors.join("; ")}.`);
        }
        if (error.code === "EEXIST") {
            throw new Error(`A content pack already exists at ${destination}. Imports never overwrite packs.`);
        }
        throw new Error(`Could not safely write ${destination}: ${error.message}`);
    }
    try {
        fileSystem.unlinkSync(temporaryPath);
    } catch (error) {
        const cleanupError = new Error(
            `The pack was imported at ${destination}, but its temporary file could not be removed: ${error.message}`
        );
        cleanupError.committed = true;
        throw cleanupError;
    }
}

function importBatch({
    target,
    inputPath,
    allowLikelyDuplicates = false,
    fileSystem = fs,
    contentDirectories = TARGETS
}) {
    const report = inspectBatch({ target, inputPath, fileSystem, contentDirectories });
    if (!report.canImport) {
        throw new Error(formatReport(report));
    }
    if (report.duplicateContent.length > 0 && !allowLikelyDuplicates) {
        throw new Error(
            `${formatReport(report)}\nRejected all ${report.questions.length} question(s); none imported.\nLikely duplicate content requires explicit --allow-likely-duplicates approval.`
        );
    }
    fileSystem.mkdirSync(report.directory, { recursive: true });
    try {
        writeNewPackAtomically(
            report.destination,
            `${JSON.stringify(JSON.parse(fileSystem.readFileSync(report.inputPath, "utf8")), null, 2)}\n`,
            fileSystem
        );
    } catch (error) {
        if (error.committed) {
            return {
                ...report,
                imported: report.questions.length,
                rejected: 0,
                warnings: [...report.warnings, error.message]
            };
        }
        throw new Error(
            `${formatReport(report)}\nRejected all ${report.questions.length} question(s); none imported.\n${error.message}`
        );
    }
    return { ...report, imported: report.questions.length, rejected: 0 };
}

function formatReport(report) {
    const lines = [
        `Target: ${report.target}`,
        `Content pack ID: ${path.basename(report.destination, ".json")}`,
        `Candidate questions: ${report.questions.length}`,
        `Destination: ${report.destination}`
    ];
    if (report.errors.length > 0) {
        lines.push(`Errors (${report.errors.length}):`, ...report.errors.map((error) => `- ${error}`));
    } else {
        lines.push("Blocking errors: none");
    }
    if (report.warnings.length > 0) {
        lines.push(`Warnings (${report.warnings.length}):`, ...report.warnings.map((warning) => `- ${warning}`));
    } else {
        lines.push("Warnings: none");
    }
    if (report.duplicateContent.length > 0) {
        lines.push(`Likely duplicate content (${report.duplicateContent.length}):`, ...report.duplicateContent.map((item) => `- ${item}`));
        lines.push(`Duplicate match records: ${report.duplicateMatches?.length ?? 0}`);
        for (const match of report.duplicateMatches ?? []) {
            lines.push(
                `  Candidate "${match.candidateId}" matches game "${match.gameId}" pack "${match.contentPackId}" question "${match.existingQuestionId}" (${match.scope}${match.matchSource ? `, ${match.matchSource}` : ""}).`
            );
        }
    } else {
        lines.push("Likely duplicate content: none");
    }
    if (report.imported !== undefined || !report.canImport) {
        lines.push(
            `Accepted: ${report.imported ?? 0}`,
            `Rejected: ${report.rejected ?? report.questions.length}`
        );
    } else if (report.duplicateContent.length > 0) {
        lines.push(
            `Pending explicit duplicate-content approval: ${report.questions.length}`,
            "Rejected: 0"
        );
    } else {
        lines.push(`Eligible for import: ${report.questions.length}`, "Rejected: 0");
    }
    return lines.join("\n");
}

function parseArguments(args) {
    const options = { command: args[0], target: null, inputPath: null, allowLikelyDuplicates: false };
    if (!["preview", "import"].includes(options.command)) {
        throw new Error("Usage: node manage-question-batch.js <preview|import> --target <fact-or-cap|fact-or-cap-anime> --input <batch.json> [--allow-likely-duplicates]");
    }
    for (let index = 1; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--target" && args[index + 1]) {
            options.target = args[++index];
        } else if (argument === "--input" && args[index + 1]) {
            options.inputPath = args[++index];
        } else if (argument === "--allow-likely-duplicates") {
            options.allowLikelyDuplicates = true;
        } else {
            throw new Error(`Unexpected or incomplete argument: ${argument}`);
        }
    }
    if (!options.target || !options.inputPath) {
        throw new Error("Both --target and --input are required.");
    }
    if (options.allowLikelyDuplicates && options.command !== "import") {
        throw new Error("--allow-likely-duplicates is only valid for import.");
    }
    return options;
}

if (require.main === module) {
    try {
        const options = parseArguments(process.argv.slice(2));
        if (options.command === "preview") {
            const report = inspectBatch(options);
            console.log(formatReport(report));
            if (!report.canImport) {
                process.exitCode = 1;
            }
        } else {
            const report = importBatch(options);
            console.log(`${formatReport(report)}\nImported ${report.questions.length} question(s).`);
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    CONTENT_ROOT,
    TARGETS,
    collectDuplicates,
    formatReport,
    importBatch,
    inspectBatch,
    parseArguments,
    writeNewPackAtomically
};
