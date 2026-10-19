const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { decodeUtf8, findTextIntegrityIssues } = require("../content/textIntegrity");
const { validateQuestionPack: validateBruhPack } = require("../games/bruh-wtf/questionLibrary");
const { readPack: readFactOrCapPack } = require("../games/fact-or-cap/questionLibrary");

test("text integrity accepts contractions, typographic punctuation, and ordinary question marks", () => {
    for (const text of [
        "What's happening?",
        "isn't it?",
        "they’re ready — aren’t they?",
        "What did Misato do?",
        "東京で何をする？"
    ]) {
        assert.deepEqual(findTextIntegrityIssues(text), [], text);
    }
});

test("text integrity identifies suspicious apostrophe substitutions and common mojibake", () => {
    for (const text of [
        "Misato?s turn", "isn?t it", "they?re ready", "we?ve arrived",
        "they?ll return", "I?d agree", "youâ€™re here", "cafÃ©"
    ]) {
        assert.ok(findTextIntegrityIssues(text).length > 0, text);
    }
    assert.deepEqual(findTextIntegrityIssues("replacement � character").map(({ substring }) => substring), ["�"]);
});

test("strict UTF-8 decoding rejects malformed bytes with the filename", () => {
    assert.throws(() => decodeUtf8(Buffer.from([0x61, 0xc3, 0x28]), "broken-pack.json"), /broken-pack\.json: invalid UTF-8/u);
    assert.equal(decodeUtf8(Buffer.from("café", "utf8")), "café");
});

test("Bruh prompt validation reports text corruption with file and question identity", () => {
    const bruh = validateBruhPack({
        formatVersion: 1,
        contentPackId: "fixture-pack",
        packType: "development-fixture",
        questions: [{ id: "bruh-id", prompt: "Misato?s turn {{player1}}", requiredPlayers: 1, category: "ordinary-life", contentPackId: "fixture-pack" }]
    }, "fixture-pack.json");
    assert.match(bruh.errors.join("\n"), /fixture-pack\.json: question "bruh-id".*"Misato\?s"/u);
});

test("Fact-or-Cap and Anime pack parsing reject malformed UTF-8", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-anime-utf8-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, "bad.json");
    fs.writeFileSync(filePath, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]));
    assert.throws(() => readFactOrCapPack(filePath), /invalid UTF-8/u);
});

