const fs = require("node:fs");
const path = require("node:path");
const { readPack, validateQuestionLibrary } = require("./questionLibrary");

const contentDirectory = path.join(__dirname, "content");

function validateAll(directory = contentDirectory) {
    const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json")).sort();
    const packs = [];
    const readErrors = [];
    for (const file of files) {
        const filePath = path.join(directory, file);
        try {
            packs.push({ fileName: file, data: readPack(filePath) });
        } catch (error) {
            readErrors.push(`${file}: ${error.message}`);
        }
    }
    if (files.length === 0) readErrors.push(`${directory}: no JSON question packs found.`);
    const result = validateQuestionLibrary(packs);
    return { ...result, errors: [...readErrors, ...result.errors], packCount: files.length };
}

function validateIndividual(filePath, directory = contentDirectory) {
    const absolutePath = path.resolve(filePath);
    const candidate = readPack(absolutePath);
    const packs = [];
    const errors = [];
    const existingFiles = fs.readdirSync(directory).filter((file) => file.endsWith(".json")).sort();
    for (const file of existingFiles) {
        const existingPath = path.resolve(directory, file);
        if (existingPath.toLowerCase() === absolutePath.toLowerCase()) continue;
        try {
            packs.push({ fileName: file, data: readPack(existingPath) });
        } catch (error) {
            errors.push(`${file}: ${error.message}`);
        }
    }
    packs.push({ fileName: path.relative(process.cwd(), absolutePath) || absolutePath, data: candidate });
    const result = validateQuestionLibrary(packs);
    return { ...result, errors: [...errors, ...result.errors], packCount: packs.length, candidate };
}

function main(args = process.argv.slice(2), output = console, directory = contentDirectory) {
    if (args.length === 1 && args[0] === "--all") {
        const result = validateAll(directory);
        if (result.errors.length) {
            result.errors.forEach((error) => output.error(`ERROR: ${error}`));
            return 1;
        }
        output.log(`Validated ${result.packCount} Bruh wtf? pack(s) and ${result.questions.length} question(s).`);
        return 0;
    }
    if (args.length !== 1 || args[0].startsWith("-")) {
        output.error("Usage: npm run validate:bruh-wtf -- <pack.json> | --all");
        return 2;
    }
    const input = args[0];
    const filePath = path.resolve(process.cwd(), input);
    try {
        const { candidate: pack, errors } = validateIndividual(filePath, directory);
        if (errors.length) {
            errors.forEach((error) => output.error(`ERROR: ${error}`));
            return 1;
        }
        output.log(`Valid Bruh wtf? pack "${pack.contentPackId}" (${pack.questions.length} questions).`);
        return 0;
    } catch (error) {
        output.error(`ERROR: ${error.message}`);
        return 1;
    }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, validateAll, validateIndividual };
