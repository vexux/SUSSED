const questionBank = require("./animeQuestionBank");
const { createFakeAnswerGame } = require("./game");

module.exports = createFakeAnswerGame({
    id: "fact-or-cap-anime",
    displayName: "Fact or Cap (Anime)",
    description: "A bluffing party game about surprising and verifiable anime facts.",
    questionBank
});
