const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { git } = require("../server/publicationWorktree");
const { incoming, directories, ledgers } = require("../server/inventory");
const { workspace, operation, digest } = require("../server/drafts");
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-promotion-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, "source");
  fs.mkdirSync(repo);
  git(repo, ["init", "-b", "dev"]);
  git(repo, ["config", "user.name", "Fixture"]);
  git(repo, ["config", "user.email", "fixture@example.test"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  const write = (file, bytes) => {
    const p = path.join(repo, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  };
  for (const dir of [
    directories.anime,
    directories.general,
    incoming,
    "studio",
  ])
    write(dir + "/.keep", "");
  const ledger = {
    ledgerVersion: 1,
    bankSnapshot: { questionCount: 0, contentPackCount: 0 },
    franchises: [],
  };
  write(ledgers.anime, JSON.stringify(ledger));
  write(".gitignore", "studio/.local/\n");
  git(repo, [
    "add",
    "--",
    ".gitignore",
    "studio/.keep",
    directories.general + "/.keep",
    directories.anime + "/.keep",
    incoming + "/.keep",
    ledgers.anime,
  ]);
  git(repo, ["commit", "-m", "Synthetic baseline"]);
  const pack = {
    contentPackId: "sample",
    questions: [
      {
        id: "sample-q",
        text: "The fixture is ____?",
        correctCompletion: "synthetic",
        sourceName: "Fixture",
        sourceUrl: "https://example.test",
      },
    ],
  };
  write(incoming + "/candidate.json", JSON.stringify(pack));
  const id = digest("candidate.json");
  const act = (action, body) =>
    operation(repo, id, action, {
      version: workspace(repo, id).version,
      ...body,
    });
  act("target", { target: "anime" });
  act("metadata", {
    metadata: {
      manifestVersion: 1,
      franchises: [
        { franchiseId: "fixture", displayName: "Fixture", aliases: [] },
      ],
      entries: [{ questionId: "sample-q", franchiseId: "fixture" }],
    },
  });
  const review = {
    decision: "reviewed",
    reviewer: "Editor",
    notes: "Reviewed fixture",
    checks: workspace(repo, id).checklist,
  };
  const draft = act("review", review);
  const approval = {
    approvalVersion: 1,
    target: "fact-or-cap-anime",
    contentPackId: "sample",
    candidateSha256: draft.candidateHash,
    ledgerMetadataSha256: digest(JSON.stringify(draft.metadata)),
    reviewerId: "Editor",
    approvedAt: "2026-01-01T00:00:00Z",
    rationale: "Reviewed fixture",
    decisions: [{ questionId: "sample-q", outcome: "publish" }],
  };
  return {
    repo,
    temp,
    id,
    pack,
    ledger,
    act,
    review,
    body: { version: draft.version, approval },
    write,
  };
}
module.exports = { fixture };
