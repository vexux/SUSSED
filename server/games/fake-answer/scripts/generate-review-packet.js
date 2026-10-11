#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { generateReviewPacket } = require("../reviewPacket");

const DEFAULT_CANDIDATES = path.join(__dirname, "..", "content-canonical", "review-shadow-batch.json");

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Unable to read ${label} "${filePath}": ${error.message}`);
    }
}

function main(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--help") {
            console.log("Usage: node games/fake-answer/scripts/generate-review-packet.js [--candidates <plan.json>] [--canonical <content.json>] [--migration <manifest.json>] [--reviews <decisions.json>] [--source-review-findings <findings.json>] [--intended-use <id>]");
            return 0;
        }
        const value = args[index + 1];
        if (["--candidates", "--canonical", "--migration", "--reviews", "--source-review-findings", "--intended-use"].includes(flag) && !value) {
            throw new Error(`Option ${flag} requires a value.`);
        }
        if (flag === "--candidates") options.candidatePath = value, index += 1;
        else if (flag === "--canonical") options.canonicalPath = value, index += 1;
        else if (flag === "--migration") options.migrationPath = value, index += 1;
        else if (flag === "--reviews") options.reviewPath = value, index += 1;
        else if (flag === "--source-review-findings") options.sourceReviewFindingsPath = value, index += 1;
        else if (flag === "--intended-use") options.intendedUse = value, index += 1;
        else throw new Error(`Unknown option "${flag}".`);
    }
    const candidateManifest = readJson(options.candidatePath ?? DEFAULT_CANDIDATES, "candidate plan");
    const packet = generateReviewPacket(candidateManifest, {
        ...(options.canonicalPath ? { canonicalContent: readJson(options.canonicalPath, "canonical content") } : {}),
        ...(options.migrationPath ? { migrationManifest: readJson(options.migrationPath, "migration manifest") } : {}),
        ...(options.reviewPath ? { reviewManifest: readJson(options.reviewPath, "review decision manifest") } : {}),
        ...(options.sourceReviewFindingsPath ? { sourceReviewFindings: readJson(options.sourceReviewFindingsPath, "source-review findings") } : {}),
        ...(options.intendedUse ? { intendedUse: options.intendedUse } : {})
    });
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
    return 0;
}

try {
    process.exitCode = main(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}
