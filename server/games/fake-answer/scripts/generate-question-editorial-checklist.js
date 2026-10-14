#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { inspectBatch, TARGETS } = require("./manage-question-batch");
const { renderQuestionEditorialChecklist } = require("../questionEditorialChecklist");

function parseArguments(args) {
    const options = { target: null, inputPath: null };
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--help") return { help: true };
        if (["--target", "--input"].includes(flag) && args[index + 1]) {
            options[flag === "--target" ? "target" : "inputPath"] = args[++index];
        } else {
            throw new Error(`Unexpected or incomplete argument: ${flag}`);
        }
    }
    if (!options.target || !options.inputPath) {
        throw new Error("Both --target and --input are required.");
    }
    return options;
}

function main(args) {
    const options = parseArguments(args);
    if (options.help) {
        process.stdout.write("Usage: node games/fake-answer/scripts/generate-question-editorial-checklist.js --target <fact-or-cap|fact-or-cap-anime> --input <batch.json>\n");
        return 0;
    }
    const inputPath = path.resolve(options.inputPath);
    if (!Object.hasOwn(TARGETS, options.target)) {
        throw new Error(`Unknown target "${options.target}". Select one of: ${Object.keys(TARGETS).join(", ")}.`);
    }
    let candidate;
    try {
        candidate = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    } catch (error) {
        throw new Error(`Unable to read candidate batch "${inputPath}": ${error.message}`);
    }
    let preview;
    try {
        preview = inspectBatch({ target: options.target, inputPath });
    } catch (error) {
        preview = {
            target: options.target,
            errors: [error.message],
            warnings: [],
            duplicateMatches: [],
            canImport: false
        };
    }
    process.stdout.write(`${renderQuestionEditorialChecklist(candidate, preview)}\n`);
    return preview.canImport ? 0 : 1;
}

try {
    process.exitCode = main(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}
