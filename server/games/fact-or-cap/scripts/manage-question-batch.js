const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { CONTENT_ROOT, TARGETS, collectDuplicates, inspectBatch } = require("../questionBatchInspection");

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
