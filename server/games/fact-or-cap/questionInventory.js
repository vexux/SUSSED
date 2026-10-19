const fs = require("node:fs");
const path = require("node:path");
const { duplicateKey, validateQuestionLibrary, validateQuestionPack } = require("./questionLibrary");
const { decodeUtf8 } = require("../../content/textIntegrity");

function questionEntries(data) {
    return Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : [];
}

function questionDetails(question, gameId, packId, fileName) {
    return {
        gameId,
        contentPackId: question.contentPackId ?? packId ?? null,
        questionId: question.questionId ?? question.id,
        fileName
    };
}

function findDuplicateGroups(records, getKey) {
    const groups = new Map();
    for (const record of records) {
        const key = getKey(record);
        if (!key) continue;
        const group = groups.get(key) ?? [];
        group.push(record);
        groups.set(key, group);
    }
    return [...groups.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([key, recordsInGroup]) => ({ key, records: recordsInGroup }));
}

function pairwiseMatches(groups, isCrossBank = false) {
    const matches = [];
    for (const { records } of groups) {
        for (let left = 0; left < records.length; left += 1) {
            for (let right = left + 1; right < records.length; right += 1) {
                if (isCrossBank && records[left].gameId === records[right].gameId) continue;
                matches.push([records[left], records[right]]);
            }
        }
    }
    return matches;
}

function buildQuestionInventory({ contentDirectories, fileSystem = fs }) {
    const allQuestions = [];
    const banks = Object.entries(contentDirectories)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([gameId, directory]) => {
            let fileNames = [];
            const readErrors = [];
            try {
                fileNames = fileSystem.readdirSync(directory)
                    .filter((fileName) => fileName.endsWith(".json"))
                    .sort();
            } catch (error) {
                readErrors.push(`${directory}: unable to list content packs: ${error.message}`);
            }

            const packs = [];
            const validationInput = [];
            const questions = [];
            for (const fileName of fileNames) {
                const fullPath = path.join(directory, fileName);
                let data;
                try {
                    data = JSON.parse(decodeUtf8(fileSystem.readFileSync(fullPath), fullPath));
                } catch (error) {
                    const message = `${fullPath}: unable to read JSON: ${error.message}`;
                    readErrors.push(message);
                    packs.push({ fileName, contentPackId: null, questionCount: 0, validQuestionCount: 0, errors: [message], warnings: [] });
                    continue;
                }

                const root = Array.isArray(data) ? null : data;
                const packId = typeof root?.contentPackId === "string" ? root.contentPackId : null;
                const rawQuestions = questionEntries(data);
                const result = validateQuestionPack(data, fullPath);
                packs.push({
                    fileName,
                    contentPackId: packId,
                    questionCount: rawQuestions.length,
                    validQuestionCount: result.questions.length,
                    errors: result.errors,
                    warnings: result.warnings
                });
                validationInput.push({ fileName: fullPath, data });
                const validRecords = result.questions.map((question) => ({
                    ...questionDetails(question, gameId, packId, fileName),
                    text: question.text,
                    correctCompletion: question.correctCompletion
                }));
                questions.push(...validRecords);
                allQuestions.push(...validRecords);
            }

            const libraryValidation = validateQuestionLibrary(validationInput);
            const duplicateIdGroups = findDuplicateGroups(questions, ({ questionId }) => questionId);
            const duplicateContentGroups = findDuplicateGroups(questions, (question) =>
                typeof question.text === "string" && typeof question.correctCompletion === "string"
                    ? duplicateKey(question)
                    : null
            );
            const duplicateIdMatches = duplicateIdGroups.map(({ key, records }) => ({
                questionId: key,
                records: records.map(({ gameId: _gameId, text: _text, correctCompletion: _completion, ...record }) => record)
            }));
            const likelyDuplicateMatches = pairwiseMatches(duplicateContentGroups).map(([left, right]) => ({
                first: questionDetails(left, gameId, left.contentPackId, left.fileName),
                second: questionDetails(right, gameId, right.contentPackId, right.fileName)
            }));
            const validationErrors = [...new Set([...readErrors, ...libraryValidation.errors])].sort();
            return {
                gameId,
                directory,
                packs,
                totalQuestions: packs.reduce((total, pack) => total + pack.questionCount, 0),
                totalValidQuestions: questions.length,
                duplicateIdCount: duplicateIdGroups.reduce((total, group) => total + group.records.length - 1, 0),
                duplicateIdMatches,
                likelyDuplicateContentCount: likelyDuplicateMatches.length,
                likelyDuplicateMatches,
                validationErrors,
                warnings: libraryValidation.warnings
            };
        });

    const crossBankDuplicateIds = findDuplicateGroups(allQuestions, ({ questionId }) => questionId)
        .filter(({ records }) => new Set(records.map(({ gameId }) => gameId)).size > 1)
        .map(({ key, records }) => ({
            questionId: key,
            records: records.map(({ text: _text, correctCompletion: _completion, ...record }) => record)
        }));
    const crossBankDuplicateContent = pairwiseMatches(
        findDuplicateGroups(allQuestions, (question) =>
            typeof question.text === "string" && typeof question.correctCompletion === "string"
                ? duplicateKey(question)
                : null
        ),
        true
    ).map(([left, right]) => ({
        first: questionDetails(left, left.gameId, left.contentPackId, left.fileName),
        second: questionDetails(right, right.gameId, right.contentPackId, right.fileName)
    }));

    return {
        banks,
        crossBankDuplicateIds,
        crossBankLikelyDuplicateContentCount: crossBankDuplicateContent.length,
        crossBankLikelyDuplicateMatches: crossBankDuplicateContent,
        hasErrors: banks.some((bank) => bank.validationErrors.length > 0) || crossBankDuplicateIds.length > 0
    };
}

function formatQuestionInventory(inventory) {
    const lines = [];
    for (const bank of inventory.banks) {
        lines.push(`${bank.gameId} (${bank.directory})`);
        lines.push(`  Packs: ${bank.packs.length}; questions: ${bank.totalQuestions}; structurally valid questions: ${bank.totalValidQuestions}`);
        for (const pack of bank.packs) {
            lines.push(`  - ${pack.fileName} [${pack.contentPackId ?? "missing pack ID"}]: ${pack.questionCount} questions (${pack.validQuestionCount} valid)`);
        }
        lines.push(`  Duplicate question IDs: ${bank.duplicateIdCount}`);
        lines.push(`  Likely normalized prompt/answer matches: ${bank.likelyDuplicateContentCount}`);
        if (bank.validationErrors.length > 0) {
            lines.push(`  Validation errors (${bank.validationErrors.length}):`);
            for (const error of bank.validationErrors) lines.push(`    - ${error}`);
        } else {
            lines.push("  Validation errors: none");
        }
        if (bank.warnings.length > 0) {
            lines.push(`  Warnings (${bank.warnings.length}):`);
            for (const warning of bank.warnings) lines.push(`    - ${warning}`);
        }
    }
    lines.push(`Cross-bank duplicate question IDs: ${inventory.crossBankDuplicateIds.length}`);
    lines.push(`Cross-bank likely normalized prompt/answer matches: ${inventory.crossBankLikelyDuplicateContentCount}`);
    if (inventory.crossBankDuplicateIds.length > 0) {
        for (const duplicate of inventory.crossBankDuplicateIds) {
            lines.push(`  - ${duplicate.questionId}: ${duplicate.records.map((record) => `${record.gameId}/${record.contentPackId}/${record.questionId}`).join(", ")}`);
        }
    }
    if (inventory.crossBankLikelyDuplicateMatches.length > 0) {
        for (const match of inventory.crossBankLikelyDuplicateMatches) {
            lines.push(`  - ${match.first.gameId}/${match.first.contentPackId}/${match.first.questionId} matches ${match.second.gameId}/${match.second.contentPackId}/${match.second.questionId}`);
        }
    }
    lines.push("Duplicate content uses normalized prompt-and-answer matching; matches are review signals, not semantic equivalence.");
    return lines.join("\n");
}

module.exports = { buildQuestionInventory, formatQuestionInventory };
