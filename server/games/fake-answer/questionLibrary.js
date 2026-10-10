const fs = require("node:fs");
const path = require("node:path");

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const QUESTION_FIELDS = new Set([
    "id",
    "text",
    "correctCompletion",
    "sourceName",
    "sourceUrl",
    "category",
    "tags",
    "difficulty",
    "contentPackId",
]);

function normalizeForComparison(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function duplicateKey(question) {
    return `${normalizeForComparison(question.text)}|${normalizeForComparison(question.correctCompletion)}`;
}

function readPack(filePath) {
    let text;
    try {
        text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
        throw new Error(`Unable to read question pack "${filePath}": ${error.message}`);
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON in "${filePath}": ${error.message}`);
    }
}

function validateQuestionPack(data, fileName = "<input>") {
    const errors = [];
    const warnings = [];
    const root = Array.isArray(data) ? { questions: data } : data;

    if (!root || typeof root !== "object" || Array.isArray(root)) {
        return {
            questions: [],
            errors: [`${fileName}: expected an object with a questions array.`],
            warnings,
        };
    }

    const packId = root.contentPackId;
    if (packId !== undefined && (typeof packId !== "string" || packId.trim() === "")) {
        errors.push(`${fileName}: contentPackId must be a non-empty string when supplied.`);
    }
    if (!Array.isArray(root.questions)) {
        errors.push(`${fileName}: questions must be an array.`);
        return { questions: [], errors, warnings };
    }

    const questions = [];
    const ids = new Map();
    const contentKeys = new Map();

    root.questions.forEach((entry, index) => {
        const label = entry && typeof entry === "object" && !Array.isArray(entry) &&
            typeof entry.id === "string" && entry.id.trim() !== ""
            ? `question "${entry.id}"`
            : `question at index ${index}`;
        const prefix = `${fileName}: ${label}`;

        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            errors.push(`${prefix} must be an object.`);
            return;
        }

        const before = errors.length;
        for (const field of ["id", "text", "correctCompletion"]) {
            if (typeof entry[field] !== "string" || entry[field].trim() === "") {
                errors.push(`${prefix} requires a non-empty string "${field}".`);
            }
        }
        for (const field of ["sourceName", "sourceUrl", "category", "contentPackId"]) {
            if (entry[field] !== undefined && (
                typeof entry[field] !== "string" || entry[field].trim() === ""
            )) {
                errors.push(`${prefix} field "${field}" must be a non-empty string when supplied.`);
            }
        }
        if (
            entry.sourceUrl !== undefined &&
            typeof entry.sourceUrl === "string" &&
            entry.sourceUrl.trim() !== ""
        ) {
            let sourceUrl;
            try {
                sourceUrl = new URL(entry.sourceUrl);
            } catch {
                errors.push(`${prefix} has an invalid sourceUrl "${entry.sourceUrl}".`);
            }
            if (sourceUrl && !["http:", "https:"].includes(sourceUrl.protocol)) {
                errors.push(`${prefix} sourceUrl must use HTTP or HTTPS.`);
            }
        }
        if (entry.tags !== undefined && (
            !Array.isArray(entry.tags) ||
            entry.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")
        )) {
            errors.push(`${prefix} field "tags" must be an array of non-empty strings.`);
        }
        if (
            entry.difficulty !== undefined &&
            (typeof entry.difficulty !== "string" || !DIFFICULTIES.has(entry.difficulty))
        ) {
            errors.push(`${prefix} difficulty must be "easy", "medium", or "hard".`);
        }
        for (const field of Object.keys(entry)) {
            if (!QUESTION_FIELDS.has(field)) {
                warnings.push(`${prefix} has unrecognized field "${field}".`);
            }
        }
        if (errors.length !== before) {
            return;
        }

        if (!entry.sourceName || !entry.sourceUrl) {
            warnings.push(`${prefix} is missing source information.`);
        }
        if (ids.has(entry.id)) {
            errors.push(
                `${prefix} duplicates question ID "${entry.id}" already used by ${ids.get(entry.id)}.`
            );
        } else {
            ids.set(entry.id, prefix);
        }

        const key = duplicateKey(entry);
        if (contentKeys.has(key)) {
            warnings.push(
                `${prefix} may duplicate ${contentKeys.get(key)} (normalized prompt and answer match).`
            );
        } else {
            contentKeys.set(key, prefix);
        }

        questions.push({
            ...entry,
            ...(entry.contentPackId === undefined && typeof packId === "string"
                ? { contentPackId: packId }
                : {}),
            ...(entry.tags === undefined ? {} : { tags: [...entry.tags] }),
        });
    });

    return { questions, errors, warnings };
}

function validateQuestionLibrary(packs) {
    const errors = [];
    const warnings = [];
    const questions = [];
    const ids = new Map();
    const contentKeys = new Map();

    for (const { fileName, data } of packs) {
        const result = validateQuestionPack(data, fileName);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
        for (const question of result.questions) {
            const label = `${fileName}: question "${question.id}"`;
            if (ids.has(question.id)) {
                errors.push(
                    `${label} duplicates question ID "${question.id}" already used by ${ids.get(question.id)}.`
                );
            } else {
                ids.set(question.id, label);
            }
            const key = duplicateKey(question);
            if (contentKeys.has(key)) {
                warnings.push(
                    `${label} may duplicate ${contentKeys.get(key)} (normalized prompt and answer match).`
                );
            } else {
                contentKeys.set(key, label);
            }
            questions.push(question);
        }
    }

    return { questions, errors, warnings };
}

function loadQuestionPacks(directory) {
    const files = fs.readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort();
    const packs = files.map((fileName) => {
        const filePath = path.join(directory, fileName);
        return { fileName, data: readPack(filePath) };
    });
    const result = validateQuestionLibrary(packs);
    if (result.errors.length > 0) {
        throw new Error(`Question library validation failed:\n${result.errors.join("\n")}`);
    }
    return result;
}

module.exports = {
    duplicateKey,
    loadQuestionPacks,
    normalizeForComparison,
    readPack,
    validateQuestionLibrary,
    validateQuestionPack,
};
