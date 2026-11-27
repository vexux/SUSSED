const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture } = require("./publicationFixture.cjs");
const { workflow } = require("../server/publicationWorkflow");
const { git, head, baseline } = require("../server/publicationWorktree");
const { preview } = require("../server/publicationPreview");
const { publish, pathsFor } = require("../server/publicationBridge");
const { incoming } = require("../server/inventory");

test("resumes exact-path promotion through a bare remote, verifies integrated objects and guards originals", (t) => {
  const f = fixture(t),
    remote = path.join(f.temp, "remote.git");
  git(f.repo, ["init", "--bare", remote]);
  git(f.repo, ["remote", "add", "origin", remote]);
  git(f.repo, ["push", "origin", "dev:refs/heads/dev"]);
  let pr = null,
    creates = 0,
    merges = 0,
    allowMerge = false;
  const deps = {
    acceptOrigin: (url) => url === remote,
    github: (root, args) => {
      if (args.includes("POST")) {
        creates++;
        pr = {
          number: 9,
          state: "open",
          base: {
            ref: "dev",
            repo: { full_name: "vexux/SUSSED" },
            sha: head(f.repo),
          },
          head: {
            ref: "data",
            repo: { full_name: "vexux/SUSSED" },
            sha: head(root),
          },
          html_url: "https://example.test/9",
          mergeable: true,
        };
        throw Error("Fixture dropped the response after creating the PR");
      }
      if (args.includes("PUT")) {
        assert.ok(allowMerge);
        merges++;
        git(root, ["push", remote, head(root) + ":refs/heads/dev"]);
        pr.merged_at = "2026-01-01";
        pr.state = "closed";
        return JSON.stringify({ merged: true });
      }
      if (args[0].includes("?")) return JSON.stringify(pr ? [pr] : []);
      return JSON.stringify(pr);
    },
  };
  let transactionId;
  const ask = (action, confirmation) =>
    workflow(f.repo, { action, transactionId, confirmation }, deps);
  const run = (action) => {
    const r = ask(action);
    assert.equal(r.status, "confirmation-required");
    return ask(action, r.actionId);
  };
  assert.equal(ask("inspect").baseline, "dev-simulation");
  assert.throws(() => ask("setup", "incorrect"), /confirm again/);
  run("setup");
  const data = baseline(f.repo).root;
  t.after(() =>
    fs.rmSync(pathsFor(data).temporaryEvidenceDirectory, {
      force: true,
      recursive: true,
    }),
  );
  const seen = preview(f.repo, f.id, f.body);
  transactionId = seen.previewId;
  publish(f.repo, f.id, {
    ...f.body,
    expectedPreviewId: transactionId,
    confirmation: "publish " + transactionId,
  });
  assert.equal(ask("progress").status, "published-awaiting-commit");
  fs.writeFileSync(path.join(data, "unrelated"), "retain");
  assert.throws(() => ask("commit"), /Unexpected changed paths/);
  fs.unlinkSync(path.join(data, "unrelated"));
  const output = path.join(data, seen.files[0].path);
  const exact = fs.readFileSync(output);
  fs.appendFileSync(output, " ");
  git(data, ["add", "--", seen.files[0].path]);
  fs.writeFileSync(output, exact);
  assert.throws(() => run("commit"), /different staged content/);
  git(data, ["add", "--", seen.files[0].path]);
  const committed = run("commit").commit;
  assert.equal(ask("commit").commit, committed);
  assert.equal(ask("progress").status, "committed-awaiting-push");
  assert.throws(() => ask("pr"), /pushed first/);
  git(f.repo, ["--git-dir", remote, "config", "receive.hideRefs", "refs/heads/data"]);
  assert.throws(() => run("push"), /hidden ref/);
  assert.equal(head(data), committed);
  git(f.repo, ["--git-dir", remote, "config", "--unset", "receive.hideRefs"]);
  assert.equal(run("push").status, "pushed");
  assert.equal(ask("push").status, "already-pushed");
  assert.equal(ask("progress").status, "pushed-awaiting-pr");
  assert.throws(() => run("cleanup"), /not integrated/);
  const create = ask("pr");
  assert.equal(create.status, "confirmation-required");
  assert.throws(() => ask("pr", create.actionId), /dropped the response/);
  assert.equal(ask("pr", create.actionId).status, "existing-pr");
  assert.equal(creates, 1);
  assert.equal(merges, 0);
  allowMerge = true;
  assert.equal(run("merge").status, "integrated");
  assert.equal(ask("merge").status, "merged-awaiting-verification");
  assert.equal(merges, 1);
  git(f.repo, [
    "--git-dir", remote, "update-ref", "-d", "refs/heads/data", committed,
  ]);
  assert.equal(ask("progress").status, "integrated");
  assert.equal(run("verify").devCommit, committed);
  const original = path.join(f.repo, incoming, "candidate.json"),
    bytes = fs.readFileSync(original);
  fs.appendFileSync(original, " ");
  assert.throws(() => run("cleanup"), /Incoming bytes changed/);
  fs.writeFileSync(original, bytes);
  // Simulate a lost process after the first verified holding file was deleted.
  const unlink = fs.unlinkSync;
  const interruption = t.mock.method(fs, "unlinkSync", (file) => {
    unlink(file);
    if (path.basename(file) === "original-0") throw Error("cleanup interrupted");
  });
  assert.throws(() => run("cleanup"), /cleanup interrupted/);
  interruption.mock.restore();
  fs.writeFileSync(original, bytes);
  assert.throws(() => run("cleanup"), /recreated during cleanup/);
  assert.deepEqual(fs.readFileSync(original), bytes);
  fs.unlinkSync(original);
  assert.equal(run("cleanup").status, "cleaned");
  assert.equal(run("cleanup").status, "already-cleaned");
  assert.equal(ask("progress").cleanupState, "completed");
  assert.equal(fs.existsSync(original), false);
  assert.equal(head(f.repo), pr.base.sha);
});
