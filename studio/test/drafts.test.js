const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { workspace, operation, digest } = require("../server/drafts");
const { createServer } = require("../server/index");
const ports = require("../ports.cjs");
const { incoming, ledgers, directories } = require("../server/inventory");
const repo = path.resolve(__dirname, "../..");
const filename = "studio-trial-candidate.json";
const id = digest(filename);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-draft-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of [incoming, "studio", path.dirname(ledgers.anime)])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const dir of Object.values(directories))
    fs.cpSync(path.join(repo, dir), path.join(root, dir), { recursive: true });
  for (const file of Object.values(ledgers))
    fs.copyFileSync(path.join(repo, file), path.join(root, file));
  const file = path.join(root, incoming, filename);
  const question = {
    id: "studio-q",
    text: "A unique studio draft?",
    correctCompletion: "test",
    sourceName: "Fixture",
    sourceUrl: "https://example.test",
  };
  fs.writeFileSync(
    file,
    JSON.stringify({ contentPackId: "studio-trial", questions: [question] }),
  );
  const load = () => workspace(root, id);
  const act = (d, action, body) =>
    operation(root, id, action, { version: d.version, ...body });
  const target = (value) => act(load(), "target", { target: value });
  return { root, file, load, act, target };
}
const meta = {
  manifestVersion: 1,
  franchises: [
    { franchiseId: "studio-series", displayName: "Studio Series", aliases: [] },
  ],
  entries: [{ questionId: "studio-q", franchiseId: "studio-series" }],
};
test("malformed or misidentified sidecars remain intact and a changed review stays visible as stale", (t) => {
  const f = fixture(t);
  let d = f.target("anime");
  d = f.act(d, "metadata", { metadata: meta });
  d = f.act(d, "review", {
    reviewer: "Editor",
    decision: "reviewed",
    checks: d.checklist,
    notes: "Checked fixture evidence",
  });
  const side = path.join(path.dirname(f.file), d.sideName);
  for (const contents of ["{", JSON.stringify({ ...meta, questions: [] })]) {
    fs.writeFileSync(side, contents);
    const reopened = f.load();
    assert.equal(reopened.history.at(-1).current, false);
    assert.match(reopened.metadataIssue, /reconciliation/);
    assert.throws(
      () => f.act(reopened, "metadata", { metadata: meta }),
      /reconciliation/,
    );
    assert.equal(fs.readFileSync(side, "utf8"), contents);
  }
});
test("Bruh candidate preserves its native fields, validates placeholders and has no sidecar", (t) => {
  const f = fixture(t);
  const question = {
    id: "studio-bruh",
    prompt: "What would {{player1}} order at a moon cafe?",
    requiredPlayers: 1,
    category: "friend-roasts",
    contentPackId: "studio-trial",
  };
  const pack = {
    formatVersion: 1,
    packType: "development-fixture",
    contentPackId: "studio-trial",
    questions: [question],
  };
  fs.writeFileSync(f.file, JSON.stringify(pack));
  let d = f.load();
  assert.equal(d.target, "bruh");
  assert.equal(d.sideName, null);
  assert.throws(() => f.act(d, "target", { target: "general" }));
  assert.throws(() => f.act(d, "metadata", { metadata: meta }));
  const invalid = { ...pack, questions: [{ ...question, requiredPlayers: 2 }] };
  assert.throws(() => f.act(d, "candidate", { pack: invalid }));
  pack.questions[0] = {
    ...question,
    prompt: "Which moon cafe would {{player1}} review?",
  };
  d = f.act(d, "candidate", { pack });
  assert.deepEqual(d.pack, pack);
  assert.deepEqual(f.act(d, "validate", { pack, metadata: null }).errors, []);
});
test("Anime assignments, review history and exact revision invalidation", (t) => {
  const f = fixture(t);
  const protectedFiles = [
    ...Object.values(ledgers),
    directories.anime + "/anime-bizarre-batch-009.json",
  ].map((n) => path.join(f.root, n));
  const hashes = () => protectedFiles.map((n) => digest(fs.readFileSync(n)));
  const before = hashes();
  let d = f.target("anime");
  const validate = (metadata) =>
    f.act(d, "validate", { pack: d.pack, metadata });
  assert.ok(validate(null).metadataErrors.length);
  assert.ok(validate({ ...meta, franchises: [] }).metadataErrors.length);
  assert.ok(
    validate({
      ...meta,
      franchises: [
        ...meta.franchises,
        { franchiseId: "studio-extra", displayName: "Studio Series" },
      ],
    }).metadataErrors.length,
  );
  assert.deepEqual(validate(meta).metadataErrors, []);
  assert.throws(() =>
    f.act(d, "metadata", { metadata: { manifestVersion: 2 } }),
  );
  d = f.act(d, "metadata", { metadata: meta });
  const review = {
    reviewer: "Editor",
    notes: "Evidence and wording checked in fixture",
    decision: "reviewed",
    checks: d.checklist,
  };
  assert.throws(() => f.act(d, "review", { ...review, checks: [] }));
  d = f.act(d, "review", review);
  assert.equal(f.load().history.at(-1).current, true);
  const pack = structuredClone(d.pack);
  pack.questions[0].text += " Revised";
  const updated = f.act(d, "candidate", { pack });
  assert.equal(updated.history.at(-1).current, false);
  assert.throws(() => f.act(d, "candidate", { pack }), /changed/i);
  d = f.act(updated, "review", review);
  fs.appendFileSync(path.join(path.dirname(f.file), d.sideName), " ");
  assert.equal(f.load().history.at(-1).current, false);
  assert.throws(() => f.act(d, "review", review), /changed/i);
  assert.deepEqual(hashes(), before);
});
test("General classifications and target-bank exact, normalized and ID matches", (t) => {
  const f = fixture(t);
  let d = f.target("general");
  const classification = {
    contentPackId: d.packId,
    questionId: "studio-q",
    topicId: "space-astronomy",
    subtopicId: "solar-system-objects",
    questionType: "identification",
    underlyingClaimSummary: "Fixture claim",
    repetitionReview: {
      outcome: "no-known-overlap",
      note: "Fixture comparison",
    },
  };
  const manifest = { manifestVersion: 1, classifications: [classification] };
  let r = f.act(d, "validate", { pack: d.pack, metadata: manifest });
  assert.deepEqual(r.metadataErrors, []);
  assert.throws(() =>
    f.act(d, "metadata", {
      metadata: {
        ...manifest,
        classifications: [{ ...classification, topicId: "unknown" }],
      },
    }),
  );
  d = f.act(d, "metadata", { metadata: manifest });
  const existing = JSON.parse(
    fs.readFileSync(
      path.join(
        f.root,
        directories.general,
        "general-expansion-batch-001.json",
      ),
    ),
  ).questions[0];
  const pack = {
    ...d.pack,
    questions: [
      existing,
      { ...existing, id: "different", text: existing.text.toUpperCase() },
    ],
  };
  r = f.act(d, "validate", { pack, metadata: manifest });
  assert.ok(r.matches.some((m) => m.kind === "exact"));
  assert.ok(r.matches.some((m) => m.kind === "normalized"));
  assert.match(r.errors.join(" "), /duplicate/i);
});
test("atomic save refuses invalid data, stale writers and external changes during staging", (t) => {
  const f = fixture(t),
    d = f.target("anime"),
    before = fs.readFileSync(f.file);
  assert.throws(() =>
    f.act(d, "candidate", { pack: { ...d.pack, questions: [{}] } }),
  );
  assert.deepEqual(fs.readFileSync(f.file), before);
  const flush = fs.fsyncSync;
  const mock = t.mock.method(fs, "fsyncSync", (fd) => {
    flush(fd);
    fs.appendFileSync(f.file, " ");
  });
  assert.throws(() => f.act(d, "candidate", { pack: d.pack }), /changed/i);
  mock.mock.restore();
  assert.equal(fs.readFileSync(f.file, "utf8"), before.toString() + " ");
  assert.ok(
    !fs.readdirSync(path.dirname(f.file)).some((n) => n.endsWith(".tmp")),
  );
  const rename = t.mock.method(fs, "renameSync", () => {
    throw Error("injected rename failure");
  });
  assert.throws(
    () => f.act(f.load(), "candidate", { pack: d.pack }),
    /injected/,
  );
  rename.mock.restore();
  assert.equal(fs.readFileSync(f.file, "utf8"), before.toString() + " ");
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), [filename]);
  fs.writeFileSync(f.file, "{");
  assert.throws(() => f.act(d, "candidate", { pack: d.pack }));
  assert.equal(fs.readFileSync(f.file, "utf8"), "{");
});
test("refuses traversal and linked incoming or review-state directories", (t) => {
  const f = fixture(t);
  assert.throws(() => workspace(f.root, "../draft"));
  const outside = path.join(f.root, "elsewhere");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.root, "studio/.local"), "junction");
  assert.throws(() => f.target("general"), /Linked/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.renameSync(path.dirname(f.file), path.join(f.root, "held"));
  fs.symlinkSync(outside, path.dirname(f.file), "junction");
  assert.throws(() => f.load(), /Linked/);
});
test("draft HTTP writes require approved Origin, JSON and exact request fields", async (t) => {
  const f = fixture(t),
    server = createServer(f.root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port + "/api/drafts/" + id;
  const d = await (await fetch(url)).json();
  const headers = {
    Origin: "http://127.0.0.1:" + ports.ui,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify({ target: "anime", version: d.version });
  for (const [h, b, status] of [
    [{}, body, 403],
    [{ ...headers, Origin: "http://other.test" }, body, 403],
    [{ ...headers, "Content-Type": "text/plain" }, body, 415],
    [headers, "{", 400],
    [
      headers,
      JSON.stringify({
        target: "anime",
        filename: "../published.json",
        version: d.version,
      }),
      400,
    ],
    [headers, body, 200],
    [headers, body, 409],
  ]) {
    assert.equal(
      (await fetch(url + "/target", { method: "POST", headers: h, body: b }))
        .status,
      status,
    );
  }
  assert.equal(
    Object.keys(require.cache).some((n) =>
      /manage-content-publication|contentPublication\.js$/.test(n),
    ),
    false,
  );
});
