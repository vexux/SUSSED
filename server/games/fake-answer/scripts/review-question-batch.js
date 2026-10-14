#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { buildQuestionBatchReview, formatTerminalReview, renderMarkdownReview } = require("../questionBatchReview");
const { TARGETS } = require("./manage-question-batch");
const GENERAL_LEDGER = path.resolve(__dirname, "../research/general-topic-ledger.json");

function parseArguments(args) {
    const options = { target: null, inputPath: null, outputPath: null };
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--help") return { help: true };
        if (["--target", "--input", "--output"].includes(flag) && args[index + 1]) {
            const value = args[++index];
            if (flag === "--target") options.target = value;
            else if (flag === "--input") options.inputPath = value;
            else options.outputPath = value;
        } else throw new Error(`Unexpected or incomplete argument: ${flag}`);
    }
    if (!options.target || !options.inputPath) throw new Error("Both --target and --input are required.");
    if (!Object.hasOwn(TARGETS, options.target)) {
        throw new Error(`Unknown target "${options.target}". Select one of: ${Object.keys(TARGETS).join(", ")}.`);
    }
    return options;
}

function assertSafeOutputPath(outputPath, inputPath) {
    const absoluteOutput = path.resolve(outputPath);
    if (absoluteOutput === path.resolve(inputPath)) throw new Error("Review output must not overwrite the candidate input.");
    if (path.extname(absoluteOutput).toLowerCase() !== ".md") throw new Error("Review output must be a Markdown (.md) file.");
    if (absoluteOutput === GENERAL_LEDGER) throw new Error("Review output must not overwrite the General topic ledger.");
    for (const directory of Object.values(TARGETS)) {
        const relative = path.relative(path.resolve(directory), absoluteOutput);
        if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
            throw new Error(`Review output must remain outside runtime content directories: ${absoluteOutput}`);
        }
    }
    return absoluteOutput;
}

function main(args) {
    const options = parseArguments(args);
    if (options.help) {
        process.stdout.write("Usage: node games/fake-answer/scripts/review-question-batch.js --target <fact-or-cap|fact-or-cap-anime> --input <batch.json> [--output <review.md>]\n");
        return 0;
    }
    const report = buildQuestionBatchReview(options);
    process.stdout.write(`${formatTerminalReview(report)}\n`);
    if (options.outputPath) {
        const outputPath = assertSafeOutputPath(options.outputPath, report.inputPath);
        fs.writeFileSync(outputPath, renderMarkdownReview(report), "utf8");
        process.stdout.write(`\nMarkdown review written to ${outputPath}\n`);
    }
    return report.errors.length ? 1 : 0;
}

try {
    process.exitCode = main(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}

