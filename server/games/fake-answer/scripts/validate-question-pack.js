const path = require("node:path");
const { questions: generalQuestions } = require("../questionBank");
const { questions: animeQuestions } = require("../animeQuestionBank");
const { duplicateKey, readPack, validateQuestionPack } = require("../questionLibrary");

const args = process.argv.slice(2);
let gameId = "fact-or-cap";
if (args[0] === "--game") {
    gameId = args[1];
    args.splice(0, 2);
} else if (["fact-or-cap", "fact-or-cap-anime"].includes(args[0])) {
    gameId = args.shift();
}
const inputFile = args[0];
if (!inputFile) {
    console.error("Usage: npm run validate:questions -- [fact-or-cap|fact-or-cap-anime] <content-pack.json>");
    process.exitCode = 2;
} else if (!["fact-or-cap", "fact-or-cap-anime"].includes(gameId)) {
    console.error(`Unknown game "${gameId}". Use fact-or-cap or fact-or-cap-anime.`);
    process.exitCode = 2;
} else {
    const absolutePath = path.resolve(inputFile);
    const displayPath = path.relative(process.cwd(), absolutePath) || absolutePath;
    try {
        const data = readPack(absolutePath);
        const result = validateQuestionPack(data, displayPath);
        const errors = [...result.errors];
        const warnings = [...result.warnings];
        const libraryQuestions = gameId === "fact-or-cap-anime"
            ? animeQuestions
            : generalQuestions;
        const allQuestions = [...generalQuestions, ...animeQuestions];
        const currentLibraryDirectory = path.resolve(
            __dirname,
            gameId === "fact-or-cap-anime" ? "../content-anime" : "../content"
        );
        const isCurrentLibraryPack = path.dirname(absolutePath) === currentLibraryDirectory;
        const currentLibraryIds = new Set(libraryQuestions.map((question) => question.id));
        const existingIds = new Map(
            allQuestions
                .filter((question) => !isCurrentLibraryPack || !currentLibraryIds.has(question.id))
                .map((question) => [question.id, question])
        );
        const existingContent = new Map(
            libraryQuestions
                .filter((question) => !isCurrentLibraryPack || !currentLibraryIds.has(question.id))
                .map((question) => [duplicateKey(question), question])
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
