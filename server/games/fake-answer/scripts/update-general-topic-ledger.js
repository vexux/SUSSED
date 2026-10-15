#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { buildGeneralTopicLedgerUpdate, writeLedgerAtomically } = require("../generalTopicLedgerMaintenance");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_LEDGER = path.join(ROOT, "research", "general-topic-ledger.json");
const DEFAULT_CONTENT = path.join(ROOT, "content");
const PROTECTED_CONTENT_DIRECTORIES = [
    DEFAULT_CONTENT,
    path.join(ROOT, "content-anime"),
    path.join(ROOT, "content-canonical"),
    path.resolve(ROOT, "../bruh-wtf/content")
];

function assertLedgerDestination(ledgerPath, contentDirectory) {
    const protectedDirectories = [...PROTECTED_CONTENT_DIRECTORIES, path.resolve(contentDirectory)];
    for (const directory of protectedDirectories) {
        const relative = path.relative(directory, ledgerPath);
        if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
            throw new Error(`Refusing to use a content directory as the ledger destination: ${ledgerPath}`);
        }
    }
}

function parseArguments(args) {
    const options = { ledgerPath: DEFAULT_LEDGER, contentDirectory: DEFAULT_CONTENT, classificationPath: null, apply: false };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--help") return { help: true };
        if (argument === "--apply") options.apply = true;
        else if (["--ledger", "--content-dir", "--classifications"].includes(argument) && args[index + 1]) {
            const value = path.resolve(args[++index]);
            if (argument === "--ledger") options.ledgerPath = value;
            else if (argument === "--content-dir") options.contentDirectory = value;
            else options.classificationPath = value;
        } else throw new Error(`Unexpected or incomplete argument: ${argument}`);
    }
    if (!options.classificationPath) throw new Error("--classifications <manifest.json> is required.");
    return options;
}

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Unable to read ${label} "${filePath}": ${error.message}`);
    }
}

function formatUpdate(result, apply) {
    const lines = [
        "General Fact-or-Cap ledger maintenance",
        `Mode: ${apply ? "APPLY" : "PREVIEW (read-only)"}`,
        `Result: ${result.valid ? "VALID" : "REFUSED"}`,
        `Published bank after update: ${result.resultingCounts?.questions ?? "unknown"} questions across ${result.resultingCounts?.packs ?? "unknown"} packs`,
        `New ledger records: ${result.addedRecords.length}`
    ];
    for (const record of result.addedRecords) {
        const identity = record.legacyIdentity;
        const classification = record.editorialClassification;
        lines.push(`  - ${identity.contentPackId}/${identity.questionId}: ${classification.topicId}/${classification.subtopicId}; ${classification.questionType}; repetition ${classification.repetitionReview.outcome}`);
    }
    if (result.errors.length) lines.push(`Errors (${result.errors.length}):`, ...result.errors.map((error) => `  - ${error}`));
    if (!result.valid) lines.push("Ledger was not written.");
    else if (apply) lines.push("Ledger update applied atomically.");
    else lines.push("No files were written. Review this proposal, then rerun with --apply to update only the ledger.");
    return lines.join("\n");
}

function main(args) {
    const options = parseArguments(args);
    if (options.help) {
        process.stdout.write("Usage: node games/fake-answer/scripts/update-general-topic-ledger.js --classifications <manifest.json> [--ledger <ledger.json>] [--content-dir <packs-dir>] [--apply]\n");
        return 0;
    }
    assertLedgerDestination(options.ledgerPath, options.contentDirectory);
    const ledger = readJson(options.ledgerPath, "General topic ledger");
    const manifest = readJson(options.classificationPath, "classification manifest");
    const result = buildGeneralTopicLedgerUpdate({
        ledger,
        manifest,
        contentDirectory: options.contentDirectory
    });
    process.stdout.write(`${formatUpdate(result, options.apply)}\n`);
    if (!result.valid) return 1;
    if (options.apply && result.updatedLedger) writeLedgerAtomically(options.ledgerPath, result.updatedLedger);
    return 0;
}

try {
    process.exitCode = main(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
