const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { scan, safePath } = require("../server/inventory");
const { createServer, questions } = require("../server/index");
const F = "server/games/fact-or-cap";
const B = "server/games/bruh-wtf";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(file, data) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof data === "string" ? data : JSON.stringify(data),
    );
  }
  const rows = Array.from({ length: 27 }, (_, i) => ({
    id: "q-" + i,
    text: "Prompt " + i,
    correctCompletion: "Answer",
    category: "space",
    difficulty: "easy",
  }));
  write(F + "/content/general/test.json", {
    contentPackId: "test",
    questions: rows,
  });
  write(F + "/content/anime/anime.json", {
    contentPackId: "anime",
    questions: [],
  });
  write(B + "/content/party.json", {
    formatVersion: 1,
    packType: "development-fixture",
    contentPackId: "party",
    questions: [
      {
        id: "first",
        category: "friend-roasts",
        requiredPlayers: 1,
        prompt: "Who is {{player1}}?",
        contentPackId: "party",
      },
    ],
  });
  return { root, write, rows };
}

test("inventories native records, fixtures and an absent inbox", (t) => {
  const { root } = fixture(t),
    { games, batches } = scan(root);
  assert.equal(games.general.rows.length, 27);
  assert.equal(games.general.packs.length, 1);
  assert.equal(games.bruh.rows[0].record.requiredPlayers, 1);
  assert.equal(games.bruh.rows[0].record.text, undefined);
  assert.deepEqual(games.bruh.errors, []);
  assert.deepEqual(games.bruh.charts["Required players"], [["1", 1]]);
  assert.deepEqual(batches, []);
  assert.ok(games.anime.errors.some((e) => e.includes("Coverage unavailable")));
});
test("identifies malformed, unknown, unassigned, and paired incoming records", (t) => {
  const { root, write, rows } = fixture(t);
  const drop = (name, data) => write(F + "/incoming/" + name, data);
  drop("bad.json", "{");
  drop("other.json", { hello: true });
  drop("notes.txt", "pending");
  drop("new-candidate.json", { contentPackId: "new", questions: [rows[0]] });
  drop("new-franchises.json", {
    manifestVersion: 1,
    entries: [{ questionId: "q-0", franchiseId: "one" }],
  });
  drop("science.json", { contentPackId: "science", questions: [] });
  drop("manifest.json", {
    manifestVersion: 1,
    classifications: [{ contentPackId: "science", questionId: "other" }],
  });
  drop("unpaired.json", { contentPackId: "future", questions: [{}] });
  const items = Object.fromEntries(
    scan(root).batches.map((b) => [b.filename, b]),
  );
  assert.equal(items["bad.json"].json, false);
  assert.equal(items["other.json"].kind, "Unrecognised");
  assert.equal(items["notes.txt"].json, null);
  assert.equal(items["new-candidate.json"].target, "anime");
  assert.deepEqual(items["new-candidate.json"].sidecars, [
    "new-franchises.json",
  ]);
  assert.equal(items["new-candidate.json"].duplicates.matchingPublishedIds, 1);
  assert.equal(items["science.json"].target, "general");
  assert.equal(items["unpaired.json"].target, null);
  assert.ok(items["unpaired.json"].errors.length);
});
test("filters, paginates and rejects invalid or unsupported parameters", (t) => {
  const g = scan(fixture(t).root).games.general;
  const ask = (q) => questions(g, new URLSearchParams(q));
  assert.equal(ask("page=2").rows.length, 2);
  assert.equal(
    ask("search=Q-26&difficulty=easy&category=space&pack=test.json").total,
    1,
  );
  for (const q of [
    "page=-1",
    "page=1&page=2",
    "file=outside",
    "pack=missing",
    "franchise=x",
  ])
    assert.throws(() => ask(q));
});
test("restricts paths, refuses linked directories and handles a changing file", (t) => {
  const { root, write } = fixture(t);
  assert.throws(() => safePath(root, "README.md"));
  assert.throws(() =>
    safePath(root, F + "/incoming/../research/general-topic-ledger.json"),
  );
  const outside = path.join(root, "other");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, F, "incoming"), "junction");
  assert.throws(() => scan(root), /Linked or external/);
  fs.unlinkSync(path.join(root, F, "incoming"));
  write(F + "/incoming/changing.json", {
    contentPackId: "test",
    questions: [],
  });
  const old = fs.readFileSync;
  const mock = t.mock.method(fs, "readFileSync", function (file, ...args) {
    const data = old.call(fs, file, ...args);
    if (
      typeof file === "number" &&
      data.toString().includes('"contentPackId":"test","questions":[]')
    )
      fs.appendFileSync(path.join(root, F, "incoming/changing.json"), " ");
    return data;
  });
  assert.equal(scan(root).batches[0].kind, "Unreadable");
  mock.mock.restore();
});
test("GET-only API checks host, origin and routes without loading publication or recovering a journal", async (t) => {
  const { root, write } = fixture(t);
  write(F + "/.publication-recovery/transaction.json", "sentinel");
  const server = createServer(root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  for (const [route, options, status] of [
    ["/api/inventory", {}, 200],
    ["/api/inventory", { method: "POST" }, 405],
    ["/api/health", { headers: { Origin: "http://other.test" } }, 403],
    ["/api/health", { headers: { Host: "other.test" } }, 403],
    ["/api/inventory?path=x", {}, 400],
    ["/api/batches/%2e%2e%2fsecret", {}, 404],
    ["/api/games/general/questions?page=0", {}, 400],
  ]) {
    const actual = await new Promise((resolve, reject) => {
      const request = http.request(url + route, options, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(actual, status, route);
  }
  assert.equal(
    fs.readFileSync(
      path.join(root, F, ".publication-recovery/transaction.json"),
      "utf8",
    ),
    "sentinel",
  );
  assert.equal(
    Object.keys(require.cache).some((p) =>
      /contentPublication|manage-content-publication/.test(p),
    ),
    false,
  );
});
