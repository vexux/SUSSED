const fs = require("node:fs");
const path = require("node:path");

const FORMAT_VERSION = 1;
const PACK_TYPES = new Set(["development-fixture", "production"]);
const PACK_FIELDS = new Set(["formatVersion", "contentPackId", "packType", "questions"]);
const QUESTION_FIELDS = new Set(["id", "prompt", "requiredPlayers", "category", "tags", "contentPackId"]);

function normalizePrompt(prompt) {
    return prompt
        .normalize("NFKC")
        .toLocaleLowerCase()
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
    if (typeof data.contentPackId !== "string" || !data.contentPackId.trim()) {
        errors.push(`${fileName}: contentPackId must be a non-empty string.`);
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
        }
        if (typeof question.id === "string" && question.id.trim()) {
            if (ids.has(question.id)) errors.push(`${fileName}: duplicate question ID "${question.id}".`);
            ids.add(question.id);
        }
        if (typeof question.prompt === "string" && question.prompt.trim()) {
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
        }
        if (question.contentPackId !== data.contentPackId) {
            errors.push(`${fileName}: ${label} contentPackId must match the pack.`);
        }
    });
    return { questions: data.questions, errors };
}

function loadQuestionPacks(directory = path.join(__dirname, "content")) {
    const files = fs.readdirSync(directory)
        .filter((file) => file.endsWith(".json"))
        .sort();
    const questions = [];
    const errors = [];
    const allIds = new Set();
    const allPrompts = new Set();
    for (const file of files) {
        let pack;
        try {
            pack = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
        } catch (error) {
            errors.push(`${file}: ${error.message}`);
            continue;
        }
        const validated = validateQuestionPack(pack, file);
        errors.push(...validated.errors);
        for (const question of validated.questions) {
            if (allIds.has(question.id)) errors.push(`${file}: question ID "${question.id}" is duplicated across packs.`);
            if (allPrompts.has(normalizePrompt(question.prompt))) errors.push(`${file}: normalized prompt is duplicated across packs.`);
            allIds.add(question.id);
            allPrompts.add(normalizePrompt(question.prompt));
            questions.push(question);
        }
    }
    if (errors.length) throw new Error(`Invalid Bruh wtf? question library:\n${errors.join("\n")}`);
    return questions;
}

module.exports = { FORMAT_VERSION, loadQuestionPacks, normalizePrompt, validateQuestionPack, validateTemplate };
