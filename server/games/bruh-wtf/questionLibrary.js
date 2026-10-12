const fs = require("node:fs");
const path = require("node:path");
const { decodeUtf8, findTextIntegrityIssues } = require("../../content/textIntegrity");

const FORMAT_VERSION = 1;
const PACK_TYPES = new Set(["development-fixture", "production"]);
const CATEGORIES = new Set([
    "absurd-hypotheticals", "social-flirting", "friend-roasts", "creative-chaos",
    "survival-missions", "group-chaos", "ordinary-life", "fictional-worlds",
    "confessions", "adult-humor", "pop-culture", "work-life", "money",
    "technology", "mystery", "competition", "fantasy-roles"
]);
const TAGS = new Set([
    "tone-absurd", "tone-chaotic", "tone-flirty", "tone-roast", "tone-surreal",
    "tone-wholesome", "target-one", "target-pair", "target-group",
    "adult-content", "trend-dependent", "evergreen"
]);
const STABLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PACK_FIELDS = new Set(["formatVersion", "contentPackId", "packType", "questions"]);
const QUESTION_FIELDS = new Set(["id", "prompt", "requiredPlayers", "category", "tags", "contentPackId"]);

function normalizePrompt(prompt) {
    return prompt
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/gu, " ")
        .trim();
}

function validateTemplate(question, label) {
    const matches = [...question.prompt.matchAll(/\{\{player(\d+)\}\}/gu)];
    const slots = matches.map((match) => Number(match[1]));
    const stripped = question.prompt.replace(/\{\{player\d+\}\}/gu, "");
    if (/[{}]/u.test(stripped)) {
        return `${label} has malformed placeholder syntax; use {{player1}}, {{player2}}, etc.`;
    }
    const uniqueSlots = [...new Set(slots)].sort((first, second) => first - second);
    if (
        !Number.isInteger(question.requiredPlayers) ||
        question.requiredPlayers < 1 ||
        question.requiredPlayers > 8 ||
        uniqueSlots.length !== question.requiredPlayers ||
        uniqueSlots.some((slot, index) => slot !== index + 1) ||
        matches.some((match) => String(Number(match[1])) !== match[1]) ||
        slots.length !== uniqueSlots.length
    ) {
        return `${label} must use each placeholder {{player1}} through {{playerN}} exactly once, matching requiredPlayers (1-8).`;
    }
    return null;
}

function validateQuestionPack(data, fileName = "<input>") {
    const errors = [];
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { questions: [], errors: [`${fileName}: expected a question pack object.`] };
    }
    for (const field of Object.keys(data)) {
        if (!PACK_FIELDS.has(field)) errors.push(`${fileName}: unknown pack field "${field}".`);
    }
    if (data.formatVersion !== FORMAT_VERSION) {
        errors.push(`${fileName}: formatVersion must be ${FORMAT_VERSION}.`);
    }
    if (typeof data.contentPackId !== "string" || !STABLE_ID.test(data.contentPackId)) {
        errors.push(`${fileName}: contentPackId must use stable lowercase kebab-case IDs.`);
    }
    if (!PACK_TYPES.has(data.packType)) {
        errors.push(`${fileName}: packType must be "development-fixture" or "production".`);
    }
    if (!Array.isArray(data.questions)) {
        errors.push(`${fileName}: questions must be an array.`);
        return { questions: [], errors };
    }

    const ids = new Set();
    const prompts = new Set();
    data.questions.forEach((question, index) => {
        const label = question && typeof question.id === "string" && question.id.trim()
            ? `question "${question.id}"`
            : `question at index ${index}`;
        if (!question || typeof question !== "object" || Array.isArray(question)) {
            errors.push(`${fileName}: ${label} must be an object.`);
            return;
        }
        for (const field of Object.keys(question)) {
            if (!QUESTION_FIELDS.has(field)) errors.push(`${fileName}: ${label} has unknown field "${field}".`);
        }
        for (const field of ["id", "prompt", "category"]) {
            if (typeof question[field] !== "string" || !question[field].trim()) {
                errors.push(`${fileName}: ${label} requires a non-empty ${field}.`);
            }
            if (field === "id" && typeof question.id === "string" && !STABLE_ID.test(question.id)) {
                errors.push(`${fileName}: ${label} id must use stable lowercase kebab-case IDs.`);
            }
            if (field === "category" && typeof question.category === "string" && !CATEGORIES.has(question.category)) {
                errors.push(`${fileName}: ${label} has unsupported category "${question.category}".`);
            }
        }
        if (typeof question.id === "string" && question.id.trim()) {
            if (ids.has(question.id)) errors.push(`${fileName}: duplicate question ID "${question.id}".`);
            ids.add(question.id);
        }
        if (typeof question.prompt === "string" && question.prompt.trim()) {
            for (const { substring } of findTextIntegrityIssues(question.prompt)) {
                errors.push(`${fileName}: ${label} contains suspicious text-integrity substring ${JSON.stringify(substring)}.`);
            }
            const templateError = validateTemplate(question, `${fileName}: ${label}`);
            if (templateError) errors.push(templateError);
            const normalized = normalizePrompt(question.prompt);
            if (prompts.has(normalized)) errors.push(`${fileName}: duplicate normalized prompt in ${label}.`);
            prompts.add(normalized);
        }
        if (
            typeof question.tags !== "undefined" &&
            (!Array.isArray(question.tags) || question.tags.some((tag) => typeof tag !== "string" || !tag.trim()))
        ) {
            errors.push(`${fileName}: ${label} tags must be non-empty strings.`);
        } else if (Array.isArray(question.tags)) {
            const seenTags = new Set();
            for (const tag of question.tags) {
                if (!TAGS.has(tag)) errors.push(`${fileName}: ${label} has unsupported tag "${tag}".`);
                if (seenTags.has(tag)) errors.push(`${fileName}: ${label} repeats tag "${tag}".`);
                seenTags.add(tag);
            }
        }
        if (question.contentPackId !== data.contentPackId) {
            errors.push(`${fileName}: ${label} contentPackId must match the pack.`);
        }
    });
    if (data.questions.length === 0) errors.push(`${fileName}: questions must contain at least one question.`);
    return { questions: data.questions, errors };
}

function readPack(filePath) {
    let text;
    try {
        text = decodeUtf8(fs.readFileSync(filePath), filePath);
    } catch (error) {
        throw new Error(error.message);
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${filePath}: invalid JSON: ${error.message}`);
    }
}

function validateQuestionLibrary(packs) {
    const errors = [];
    const questions = [];
    const ids = new Map();
    const prompts = new Map();
    const packIds = new Map();
    for (const { fileName, data } of packs) {
        const result = validateQuestionPack(data, fileName);
        errors.push(...result.errors);
        if (typeof data?.contentPackId === "string") {
            if (packIds.has(data.contentPackId)) {
                errors.push(`${fileName}: contentPackId "${data.contentPackId}" is already used by ${packIds.get(data.contentPackId)}.`);
            } else {
                packIds.set(data.contentPackId, fileName);
            }
        }
        for (const question of result.questions) {
            if (typeof question?.id === "string") {
                if (ids.has(question.id)) {
                    errors.push(`${fileName}: question "${question.id}" duplicates an ID in ${ids.get(question.id)}.`);
                } else {
                    ids.set(question.id, fileName);
                }
            }
            if (typeof question?.prompt === "string") {
                const normalized = normalizePrompt(question.prompt);
                if (prompts.has(normalized)) {
                    errors.push(`${fileName}: question "${question.id}" duplicates a normalized prompt in ${prompts.get(normalized)}.`);
                } else {
                    prompts.set(normalized, fileName);
                }
            }
            questions.push(question);
        }
    }
    return { questions, errors };
}

function loadQuestionPacks(directory = path.join(__dirname, "content")) {
    const files = fs.readdirSync(directory)
        .filter((file) => file.endsWith(".json"))
        .sort();
    const packs = [];
    const readErrors = [];
    for (const file of files) {
        try {
            packs.push({ fileName: file, data: readPack(path.join(directory, file)) });
        } catch (error) {
            readErrors.push(`${file}: ${error.message}`);
        }
    }
    const result = validateQuestionLibrary(packs);
    const errors = [...readErrors, ...result.errors];
    if (files.length === 0) errors.push(`${directory}: no JSON question packs found.`);
    if (errors.length) throw new Error(`Invalid Bruh wtf? question library:\n${errors.join("\n")}`);
    return result.questions;
}

module.exports = {
    CATEGORIES,
    FORMAT_VERSION,
    PACK_TYPES,
    STABLE_ID,
    TAGS,
    loadQuestionPacks,
    normalizePrompt,
    readPack,
    validateQuestionLibrary,
    validateQuestionPack,
    validateTemplate
};
