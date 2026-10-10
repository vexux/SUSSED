const path = require("node:path");
const { questions: libraryQuestions } = require("../questionBank");
const { duplicateKey, readPack, validateQuestionPack } = require("../questionLibrary");

const inputFile = process.argv[2];
if (!inputFile) {
    console.error("Usage: npm run validate:questions -- <content-pack.json>");
    process.exitCode = 2;
} else {
    const absolutePath = path.resolve(inputFile);
    const displayPath = path.relative(process.cwd(), absolutePath) || absolutePath;
    try {
        const data = readPack(absolutePath);
        const result = validateQuestionPack(data, displayPath);
        const errors = [...result.errors];
        const warnings = [...result.warnings];
        const existingIds = new Map(
            libraryQuestions.map((question) => [question.id, question])
        );
        const existingContent = new Map(
            libraryQuestions.map((question) => [duplicateKey(question), question])
        );

        for (const question of result.questions) {
            if (existingIds.has(question.id)) {
                errors.push(
                    `${displayPath}: question "${question.id}" conflicts with an ID already in the question library.`
                );
            }
            const existingDuplicate = existingContent.get(duplicateKey(question));
            if (existingDuplicate) {
                warnings.push(
                    `${displayPath}: question "${question.id}" may duplicate library question "${existingDuplicate.id}" (normalized prompt and answer match).`
                );
            }
        }

        for (const error of errors) {
            console.error(`ERROR: ${error}`);
        }
        for (const warning of warnings) {
            console.warn(`WARNING: ${warning}`);
        }
        if (errors.length > 0) {
            process.exitCode = 1;
        } else {
            console.log(
                `Validated ${result.questions.length} question(s) from ${displayPath}; no existing questions were changed.`
            );
        }
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exitCode = 1;
    }
}
