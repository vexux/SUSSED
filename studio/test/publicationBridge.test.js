const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture } = require("./publicationFixture.cjs");
const { git } = require("../server/publicationWorktree");
const { preview } = require("../server/publicationPreview");
const { publish, pathsFor } = require("../server/publicationBridge");
const { incoming } = require("../server/inventory");

test("only a fresh explicitly confirmed data preview publishes, retry returns same receipt", (t) => {
  const f = fixture(t),
    simulation = preview(f.repo, f.id, f.body);
  const confirm = (r) => ({
    ...f.body,
    expectedPreviewId: r.previewId,
    confirmation: "publish " + r.previewId,
  });
  assert.throws(() => publish(f.repo, f.id, confirm(simulation)), /dedicated/);
  const data = path.join(f.temp, "data");
  git(f.repo, ["worktree", "add", "-b", "data", data, "dev"]);
  const paths = pathsFor(fs.realpathSync.native(data));
  t.after(() =>
    fs.rmSync(paths.temporaryEvidenceDirectory, {
      recursive: true,
      force: true,
    }),
  );
  const r = preview(f.repo, f.id, f.body);
  assert.equal(r.status, "preview-ready", JSON.stringify(r.blockers));
  assert.throws(
    () => publish(f.repo, f.id, { ...confirm(r), confirmation: "" }),
    /confirmation/,
  );
  assert.throws(() => publish(f.repo, f.id, confirm(simulation)), /changed/);
  const result = publish(f.repo, f.id, confirm(r));
  assert.equal(result.status, "published");
  assert.equal(result.receipt.transactionId, r.previewId);
  assert.equal(publish(f.repo, f.id, confirm(r)).status, "already-published");
  assert.equal(
    fs.existsSync(path.join(f.repo, incoming, "candidate.json")),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(paths.trackedReceiptDirectory, r.previewId + ".json"),
    ),
    true,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(data, r.files[0].path))),
    f.pack,
  );
});

test("a candidate changed while outputs are installed rolls back without touching the new source", (t) => {
  const f = fixture(t),
    data = path.join(f.temp, "data");
  git(f.repo, ["worktree", "add", "-b", "data", data, "dev"]);
  const r = preview(f.repo, f.id, f.body),
    paths = pathsFor(fs.realpathSync.native(data));
  t.after(() =>
    fs.rmSync(paths.temporaryEvidenceDirectory, {
      recursive: true,
      force: true,
    }),
  );
  const link = fs.linkSync,
    destination = path.join(data, r.files[0].path),
    original = path.join(f.repo, incoming, "candidate.json");
  const ledger = fs.readFileSync(paths.animeLedger);
  t.mock.method(fs, "linkSync", (src, dst) => {
    link(src, dst);
    if (dst === destination) fs.appendFileSync(original, " ");
  });
  assert.throws(
    () =>
      publish(f.repo, f.id, {
        ...f.body,
        expectedPreviewId: r.previewId,
        confirmation: "publish " + r.previewId,
      }),
    /rolled back/,
  );
  assert.equal(fs.existsSync(destination), false);
  assert.deepEqual(fs.readFileSync(paths.animeLedger), ledger);
  assert.ok(fs.readFileSync(original, "utf8").endsWith(" "));
});
