#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_PATHS, TARGETS, cleanupCandidate, cleanupEligibility, createReview, formatReview, publishBatch, recoverPublication } = require("../contentPublication");
const { writeNewPackAtomically } = require("./manage-question-batch");

function parse(args) {
    const options = { command: args[0], target: null, input: null, classifications: null, franchises: null, approval: null, report: null, confirmDelete: null, json: false };
    if (!["list", "review", "publish", "cleanup", "recover"].includes(options.command)) throw new Error("Usage: questions:publication <list|review|publish|cleanup|recover> [options]");
    const aliases = new Map([["--target", "target"], ["--input", "input"], ["--classifications", "classifications"], ["--franchises", "franchises"], ["--approval", "approval"], ["--snapshot", "report"], ["--receipt", "report"], ["--report", "report"], ["--confirm-delete", "confirmDelete"]]);
    for (let index = 1; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--json") options.json = true;
        else if (aliases.has(argument) && args[index + 1]) options[aliases.get(argument)] = args[++index];
        else throw new Error(`Unexpected or incomplete argument: ${argument}`);
    }
    if (["review", "publish"].includes(options.command) && (!options.input || !options.target)) throw new Error(`${options.command} requires --target and --input.`);
    if (["review", "publish"].includes(options.command) && !Object.hasOwn(TARGETS, options.target)) throw new Error(`Unknown target. Use one of ${Object.keys(TARGETS).join(", ")}.`);
    if (options.command === "publish" && !options.approval) throw new Error("publish requires --approval <reviewed-approval.json>.");
    if (options.command === "cleanup" && (!options.input || !options.report)) throw new Error("cleanup requires --input and --receipt.");
    return options;
}

function json(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }

function main(args) {
    const options = parse(args);
    if (options.command === "recover") {
        const result = recoverPublication();
        process.stdout.write(`${result.message}\n`);
        return 0;
    }
    if (fs.existsSync(path.join(DEFAULT_PATHS.transactionDirectory, "transaction.json"))) {
        const result = recoverPublication();
        process.stderr.write(`${result.message}\n`);
    }
    if (options.command === "list") {
        if (options.target) throw new Error("list does not infer a game target from the shared incoming directory; choose a target explicitly when running review.");
        const incoming = DEFAULT_PATHS.incomingDirectory;
        if (!fs.existsSync(incoming)) return 0;
        for (const fileName of fs.readdirSync(incoming).filter((name) => name.endsWith(".json")).sort()) {
            const filePath = path.join(incoming, fileName);
            try {
                const value = json(filePath);
                if (typeof value?.contentPackId === "string" && Array.isArray(value.questions)) process.stdout.write(`unassigned\t${filePath}\t${value.contentPackId}\t${value.questions.length} questions\n`);
                else process.stdout.write(`unassigned\t${filePath}\tnot a question pack (review explicitly to see validation errors)\n`);
            } catch (error) { process.stdout.write(`unassigned\t${filePath}\tinvalid JSON: ${error.message}\n`); }
        }
        return 0;
    }
    if (options.command === "cleanup") {
        const common = { inputPath: options.input, reportPath: options.report };
        if (!options.confirmDelete) {
            const result = cleanupEligibility(common);
            process.stdout.write(`${result.eligible ? "Eligible" : "Not eligible"} for cleanup: ${path.resolve(options.input)}\n${result.errors.map((item) => `- ${item}`).join("\n")}`.trimEnd() + "\n");
            return result.eligible ? 0 : 1;
        }
        const result = cleanupCandidate({ ...common, confirmPackId: options.confirmDelete });
        process.stdout.write(`Deleted verified candidate ${result.deleted} after publication of ${result.contentPackId}.${result.deletedReceipt ? " Temporary receipt removed." : " Temporary receipt could not be removed; inspect the temporary directory."}\n`);
        return 0;
    }
    const review = createReview({
        target: options.target,
        inputPath: options.input,
        ...(options.classifications ? { classificationPath: options.classifications } : {}),
        ...(options.franchises ? { franchisePath: options.franchises } : {})
    });
    if (options.command === "review") {
        if (options.report) {
            const reportPath = path.resolve(options.report);
            const relative = path.relative(path.resolve(DEFAULT_PATHS.temporaryEvidenceDirectory), reportPath);
            if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error(`Temporary review snapshots must be saved under ${DEFAULT_PATHS.temporaryEvidenceDirectory}.`);
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            writeNewPackAtomically(reportPath, `${JSON.stringify(review.report, null, 2)}\n`);
            process.stdout.write(`Temporary review snapshot saved: ${reportPath}\n`);
        }
        process.stdout.write(options.json ? `${JSON.stringify(review.report, null, 2)}\n` : `${formatReview(review.report)}\n`);
        return review.report.blockers.length ? 1 : 0;
    }
    const reportPath = options.report ?? path.join(DEFAULT_PATHS.temporaryEvidenceDirectory, `${review.report.contentPackId}.json`);
    const approval = json(options.approval);
    const classificationManifest = options.classifications ? json(options.classifications) : null;
    const animeFranchiseManifest = options.franchises ? json(options.franchises) : null;
    const result = publishBatch({ review, approval, classificationManifest, animeFranchiseManifest, receiptPath: reportPath });
    process.stdout.write(`Published ${result.receipt.publishedQuestionIds.length} question(s) as ${result.receipt.contentPackId}.\nPack: ${result.receipt.destination}\nLedger: ${result.receipt.ledgerPath}\nTemporary receipt: ${result.receiptPath}\n`);
    return 0;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
