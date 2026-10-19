#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
    DEFAULT_LOW_TOPIC_THRESHOLD,
    compareGeneralTopicLedger,
    formatGeneralTopicLedgerReport
} = require("../generalTopicLedgerReport");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_LEDGER = path.join(ROOT, "research", "general-topic-ledger.json");
const DEFAULT_CONTENT = path.join(ROOT, "content", "general");

function parseArguments(args) {
    const options = { ledgerPath: DEFAULT_LEDGER, contentDirectory: DEFAULT_CONTENT, lowTopicThreshold: DEFAULT_LOW_TOPIC_THRESHOLD };
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--help") return { help: true };
        if (flag === "--ledger" && args[index + 1]) options.ledgerPath = path.resolve(args[++index]);
        else if (flag === "--content-dir" && args[index + 1]) options.contentDirectory = path.resolve(args[++index]);
        else if (flag === "--low-topic-threshold" && args[index + 1]) {
            const threshold = Number(args[++index]);
            if (!Number.isInteger(threshold) || threshold < 0) throw new Error("--low-topic-threshold must be a non-negative integer.");
            options.lowTopicThreshold = threshold;
        } else if (flag !== "--help") throw new Error(`Unexpected or incomplete argument: ${flag}`);
    }
    return options;
}

function main(args) {
    const options = parseArguments(args);
    if (options.help) {
        process.stdout.write("Usage: node games/fact-or-cap/scripts/report-general-content-coverage.js [--ledger <ledger.json>] [--content-dir <packs-dir>] [--low-topic-threshold <non-negative-integer>]\n");
        return 0;
    }
    let ledger;
    try {
        ledger = JSON.parse(fs.readFileSync(options.ledgerPath, "utf8"));
    } catch (error) {
        throw new Error(`Unable to read ledger "${options.ledgerPath}": ${error.message}`);
    }
    const report = compareGeneralTopicLedger({ ...options, ledger });
    process.stdout.write(`${formatGeneralTopicLedgerReport(report)}\n`);
    return report.reconciliation.valid ? 0 : 1;
}

try {
    process.exitCode = main(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}
