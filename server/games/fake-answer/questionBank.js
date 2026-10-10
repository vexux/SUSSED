const { randomInt } = require("node:crypto");
const path = require("node:path");
const { loadQuestionPacks } = require("./questionLibrary");

function selectQuestionOrder(
    pool,
    count,
    recentlyUsedIds = new Set(),
    randomIndex = randomInt
) {
    const playableQuestions = [];
    const seenIds = new Set();
    for (const question of pool) {
        if (
            question &&
            typeof question.id === "string" &&
            question.id.trim() !== "" &&
            typeof question.text === "string" &&
            question.text.trim() !== "" &&
            typeof question.correctCompletion === "string" &&
            question.correctCompletion.trim() !== "" &&
            !seenIds.has(question.id)
        ) {
            seenIds.add(question.id);
            playableQuestions.push(question);
        }
    }

    if (!Number.isInteger(count) || count < 1 || playableQuestions.length < count) {
        const error = new Error(
            `The question library needs at least ${count} valid, unique playable prompts; found ${playableQuestions.length}.`
        );
        error.code = "QUESTION_POOL_EXHAUSTED";
        throw error;
    }

    function shuffled(values) {
        const result = [...values];
        for (let index = result.length - 1; index > 0; index -= 1) {
            const swapIndex = randomIndex(index + 1);
            [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
        }
        return result;
    }

    const fresh = shuffled(
        playableQuestions.filter(({ id }) => !recentlyUsedIds.has(id))
    );
    const previouslyUsed = shuffled(
        playableQuestions.filter(({ id }) => recentlyUsedIds.has(id))
    );
    return [...fresh, ...previouslyUsed].slice(0, count);
}

function createQuestionBank(contentDirectory) {
    const { questions, warnings } = loadQuestionPacks(contentDirectory);
    for (const warning of warnings) {
        console.warn(`Question library warning: ${warning}`);
    }
    for (const question of questions) {
        if (question.tags) {
            Object.freeze(question.tags);
        }
        Object.freeze(question);
    }
    Object.freeze(questions);

    let recentlySelectedQuestionIds = new Set();
    return Object.freeze({
        questions,
        selectQuestions(count) {
            const selected = selectQuestionOrder(
                questions,
                count,
                recentlySelectedQuestionIds
            );
            recentlySelectedQuestionIds = new Set(selected.map(({ id }) => id));
            return selected;
        }
    });
}

const defaultQuestionBank = createQuestionBank(path.join(__dirname, "content"));

module.exports = {
    ...defaultQuestionBank,
    createQuestionBank,
    selectQuestionOrder
};
