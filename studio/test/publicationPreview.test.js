const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture } = require("./publicationFixture.cjs");
const { preview } = require("../server/publicationPreview");
const { digest } = require("../server/drafts");
function manifest(root) {
  const result = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    result[entry.name] = entry.isDirectory()
      ? manifest(file)
      : digest(fs.readFileSync(file));
  }
  return result;
}
test("preview uses only reads, reproduces exact Anime bytes, and honors the last decision", (t) => {
  const f = fixture(t),
    before = manifest(f.temp);
  const calls = [];
  const writers = [
    "mkdtempSync",
    "mkdirSync",
    "writeFileSync",
    "renameSync",
    "linkSync",
    "unlinkSync",
    "rmSync",
    "copyFileSync",
    "rmdirSync",
  ];
  for (const name of writers)
    t.mock.method(fs, name, () => {
      calls.push(name);
      throw Error("Unexpected write: " + name);
    });
  const open = fs.openSync;
  t.mock.method(fs, "openSync", (file, flags, ...rest) => {
    if (
      typeof flags === "string"
        ? flags !== "r"
        : flags &
          (fs.constants.O_RDWR |
            fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_TRUNC)
    ) {
      calls.push("openSync");
      throw Error("Unexpected writable descriptor");
    }
    return open(file, flags, ...rest);
  });
  const result = preview(f.repo, f.id, f.body);
  assert.equal(result.status, "simulation", JSON.stringify(result.blockers));
  assert.equal(result.files[0].after, JSON.stringify(f.pack, null, 2) + "\n");
  const expected = {
    ledgerVersion: 1,
    bankSnapshot: { questionCount: 1, contentPackCount: 1 },
    franchises: [
      {
        franchiseId: "fixture",
        displayName: "Fixture",
        aliases: [],
        questionCount: 1,
        packMemberships: [
          { contentPackId: "sample", questionIds: ["sample-q"] },
        ],
      },
    ],
  };
  assert.equal(result.files[1].after, JSON.stringify(expected, null, 2) + "\n");
  assert.equal(
    preview(f.repo, f.id, { ...f.body, expectedPreviewId: result.previewId })
      .previewId,
    result.previewId,
  );
  assert.equal(
    preview(f.repo, f.id, { ...f.body, approval: {} }).status,
    "blocked",
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(manifest(f.temp), before);
  assert.equal(
    Object.keys(require.cache).some((p) =>
      /[\\/](contentPublication|publicationTransaction|publicationBridge|manage-content-publication|manage-question-batch)\.js$/.test(
        p,
      ),
    ),
    false,
  );
  t.mock.restoreAll();
  const v = f.act("review", { ...f.review, decision: "needs-changes" });
  assert.equal(preview(f.repo, f.id, { version: v.version }).status, "blocked");
  assert.throws(() => preview(f.repo, f.id, f.body), /revision changed/);
});

test("preview HTTP boundary rejects paths, stale revisions and missing local origin", async (t) => {
  const f = fixture(t),
    server = require("../server/index").createServer(f.repo);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const post = (body, headers = { origin }) =>
    fetch(origin + "/api/drafts/" + f.id + "/publication-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await post(f.body, {})).status, 403);
  assert.equal((await post({ ...f.body, path: "candidate.json" })).status, 400);
  assert.equal((await post({ ...f.body, version: "expired" })).status, 409);
  const response = await post({ version: f.body.version });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).status, "needs-decisions");
});
test("a bank change during the final snapshot invalidates calculated bytes", (t) => {
  const f = fixture(t);
  const { directories } = require("../server/inventory");
  const bank = path.join(f.repo, directories.anime),
    original = fs.readdirSync;
  let count = 0;
  t.mock.method(fs, "readdirSync", (dir, ...args) => {
    if (dir === bank && ++count === 2)
      fs.writeFileSync(path.join(bank, "concurrent.json"), "[]");
    return original(dir, ...args);
  });
  assert.throws(
    () => preview(f.repo, f.id, f.body),
    (e) => e.status === 409,
  );
});
