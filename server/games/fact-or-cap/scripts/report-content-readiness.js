#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { evaluateReadiness } = require("../reviewDecisionManifest");

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Unable to read ${label} "${filePath}": ${error.message}`);
    }
}

function main(args) {
    if (args.length < 2 || args[0] === "--help") {
        console.error("Usage: node games/fact-or-cap/scripts/report-content-readiness.js <review-manifest.json> <canonical.json> --intended-use <id> [--migration <manifest.json>] [--allowed-rights permitted,public-domain] [--require-legacy-parity]");
        return 2;
    }
    const [reviewPath, canonicalPath, ...flags] = args;
    const options = { criteria: {} };
    for (let index = 0; index < flags.length; index += 1) {
        const flag = flags[index];
        if (flag === "--intended-use" && flags[index + 1]) options.intendedUse = flags[++index];
        else if (flag === "--migration" && flags[index + 1]) options.migrationManifest = readJson(flags[++index], "migration manifest");
        else if (flag === "--allowed-rights" && flags[index + 1]) options.criteria.allowedRightsStatuses = flags[++index].split(",").filter(Boolean);
        else if (flag === "--require-legacy-parity") options.criteria.requireLegacyParity = true;
        else throw new Error(`Unknown or incomplete option "${flag}".`);
    }
    if (!options.intendedUse) throw new Error("--intended-use is required.");
    const reviewManifest = readJson(reviewPath, "review manifest");
    const canonical = readJson(canonicalPath, "canonical content");
    const report = evaluateReadiness(reviewManifest, canonical, options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ready ? 0 : 1;
}

try {
    process.exitCode = main(process.argv.slice(2).map((arg) => path.normalize(arg)));
} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}
