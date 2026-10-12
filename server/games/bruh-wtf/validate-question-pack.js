const fs = require("node:fs");
const path = require("node:path");
const { validateQuestionPack } = require("./questionLibrary");

const input = process.argv[2];
if (!input) {
    console.error("Usage: node games/bruh-wtf/validate-question-pack.js <pack.json>");
    process.exitCode = 1;
} else {
    const filePath = path.resolve(process.cwd(), input);
    try {
        const pack = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const result = validateQuestionPack(pack, input);
        if (result.errors.length) {
            result.errors.forEach((error) => console.error(`ERROR: ${error}`));
            process.exitCode = 1;
        } else {
            console.log(`Valid Bruh wtf? pack "${pack.contentPackId}" (${result.questions.length} prompts).`);
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
