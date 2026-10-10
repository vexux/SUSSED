const path = require("node:path");
const { createQuestionBank } = require("./questionBank");

module.exports = createQuestionBank(path.join(__dirname, "content-anime"));
