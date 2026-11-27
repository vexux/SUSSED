const fs = require("node:fs");
const path = require("node:path");
const { load, digest } = require("./drafts");
const {
  incoming,
  directories,
  ledgers,
  read,
  safePath,
} = require("./inventory");
const {
  baseline,
  status,
  transactionDir,
  fail,
} = require("./publicationWorktree");
const {
  createReview,
  planPublication,
  withPack,
} = require("../../server/games/fact-or-cap/publicationPlan");
const {
  buildQuestionInventory,
} = require("../../server/games/fact-or-cap/questionInventory");

const targets = { anime: "fact-or-cap-anime", general: "fact-or-cap" };
const hash = (value) => digest(JSON.stringify(value));
const implementationFiles = [
  __filename,
  require.resolve("./drafts"),
  require.resolve("./publicationWorktree"),
  require.resolve("./inventory"),
  ...[
    "publicationPlan",
    "questionBatchInspection",
    "questionLibrary",
    "questionInventory",
    "generalTopicLedgerPreview",
    "generalTopicLedgerReport",
    "animeLedgerPreview",
  ].map((name) => require.resolve("../../server/games/fact-or-cap/" + name)),
  require.resolve("../../server/content/textIntegrity"),
];
function implementationHash() {
  return hash(
    implementationFiles.map((file) => [
      path.basename(file),
      digest(fs.readFileSync(file)),
    ]),
  );
}
const loadedImplementation = implementationHash();
function capture(repository, id, version, options = {}) {
  const draft = load(repository, id);
  const v = draft.view;
  if (v.version !== version) fail("Draft revision changed. Reload the editor.");
  const base = baseline(repository);
  const blockers = [];
  const editorial = v.history.at(-1);
  if (!Object.hasOwn(targets, v.target) || draft.samePack !== 1)
    blockers.push("A unique Anime or General candidate is required.");
  if (
    !editorial?.current ||
    editorial.decision !== "reviewed" ||
    !editorial.reviewer?.trim() ||
    !editorial.notes?.trim() ||
    !Number.isFinite(Date.parse(editorial.at)) ||
    !Array.isArray(editorial.checks) ||
    editorial.checks.length !== v.checklist.length ||
    !v.checklist.every((c) => editorial.checks.includes(c))
  )
    blockers.push(
      "Latest editorial review must cover these exact bytes and all checks.",
    );
  if (!draft.sideBytes || v.metadataIssue)
    blockers.push(v.metadataIssue || "Missing metadata sidecar.");
  if (!options.locked && fs.existsSync(transactionDir(base.root)))
    blockers.push(
      "Publication recovery directory exists; inspect recovery status.",
    );
  if (base.kind === "data-worktree" && !options.locked && status(base.root))
    blockers.push("Resolve changes in the data worktree first.");
  if (loadedImplementation !== implementationHash())
    blockers.push("Restart Studio to load changed publication code.");
  if (
    Object.hasOwn(targets, v.target) &&
    !options.applied &&
    fs.lstatSync(
      path.join(base.root, directories[v.target], v.packId + ".json"),
      { throwIfNoEntry: false },
    )
  )
    blockers.push("Destination pack already exists.");
  const summary = {
    worktreeIdentity: digest(base.root),
    plannerSha256: loadedImplementation,
    node: process.versions.node,
    icu: process.versions.icu,
    kind: base.kind,
    commit: base.commit,
    implementation: base.implementation,
    note: base.note,
  };
  if (blockers.length)
    return { blocked: { status: "blocked", blockers, baseline: summary } };
  const files = new Map(),
    listing = new Map();
  const relative = (name) =>
    path.relative(base.root, name).split(path.sep).join("/");
  const paths = {
    generalLedger: path.join(base.root, ledgers.general),
    animeLedger: path.join(base.root, ledgers.anime),
  };
  const contentDirectories = {};
  for (const [key, target] of Object.entries(targets)) {
    const dir = safePath(base.root, directories[key]);
    contentDirectories[target] = dir;
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort();
    listing.set(dir, names);
    for (const n of names)
      files.set(path.join(dir, n), read(base.root, directories[key] + "/" + n));
  }
  const ledger = ledgers[v.target];
  files.set(path.join(base.root, ledger), read(base.root, ledger));
  const inputPath = path.join(base.root, incoming, v.filename),
    side = path.join(base.root, incoming, v.sideName);
  files.set(inputPath, draft.bytes);
  files.set(side, draft.sideBytes);
  const fileSystem = {
    readFileSync(file, encoding) {
      if (!files.has(file))
        throw Error("File absent from snapshot: " + relative(file));
      return encoding
        ? files.get(file).toString(encoding)
        : Buffer.from(files.get(file));
    },
    readdirSync(dir) {
      return [...listing.get(dir)];
    },
    existsSync(file) {
      return files.has(file) || listing.has(file);
    },
  };
  const inputs = [...files]
    .map(([file, bytes]) => ({ path: relative(file), sha256: digest(bytes) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const binding = {
    schema: 1,
    draftId: id,
    version,
    baseline: summary,
    inputs,
    editorial,
    reviewStateSha256: draft.stateHash,
    target: targets[v.target],
    packId: v.packId,
    sideName: v.sideName,
  };
  const args = {
    paths,
    contentDirectories,
    fileSystem,
    inputPath,
    target: targets[v.target],
    [v.target === "anime" ? "franchisePath" : "classificationPath"]: side,
  };
  return {
    args,
    stateBytes: draft.stateBytes,
    base,
    v,
    relative,
    files,
    binding,
    summary,
    stamp: hash(binding),
  };
}

function calculate(repository, id, body, options = {}) {
  if (
    !body ||
    typeof body.version !== "string" ||
    Object.keys(body).some(
      (k) => !["version", "approval", "expectedPreviewId"].includes(k),
    )
  )
    fail("Invalid preview request.", 400);
  const snapshot = capture(repository, id, body.version, options);
  if (snapshot.blocked) {
    if (body.expectedPreviewId) fail("Preview is no longer eligible.");
    return { result: snapshot.blocked };
  }
  const { args, base, v, relative, files, binding, summary } = snapshot;
  const review = createReview(args);
  const report = {
    ...review.report,
    inputPath: relative(args.inputPath),
    proposedDestination:
      review.report.proposedDestination &&
      relative(review.report.proposedDestination),
  };
  const result = {
    status: "needs-decisions",
    baseline: summary,
    review: report,
    editorial: binding.editorial,
    blockers: [...report.blockers],
  };
  let plan;
  if (!result.blockers.length && body.approval) {
    try {
      plan = planPublication({
        ...args,
        review,
        approval: body.approval,
        classificationManifest: v.metadata,
        animeFranchiseManifest: v.metadata,
      });
      const inventory = (reader) =>
        buildQuestionInventory({
          contentDirectories: args.contentDirectories,
          fileSystem: reader,
        });
      const before = inventory(args.fileSystem),
        after = inventory(
          withPack(
            args.fileSystem,
            args.contentDirectories[args.target],
            plan.pack,
          ),
        );
      const counts = (inv) =>
        inv.banks.map((b) => ({
          target: b.gameId,
          packs: b.packs.length,
          questions: b.totalQuestions,
        }));
      if (before.hasErrors || after.hasErrors)
        throw Error("Fact or Cap bank inventory failed validation.");
      const newBank = after.banks.find((b) => b.gameId === args.target);
      const added = newBank.packs.find(
        (p) => p.fileName === path.basename(plan.destination),
      );
      if (
        added?.validQuestionCount !== plan.selected.length ||
        counts(before).some(
          (b, i) =>
            after.banks[i].packs.length !==
              b.packs + Number(b.target === args.target) ||
            after.banks[i].totalQuestions !==
              b.questions +
                (b.target === args.target ? plan.selected.length : 0),
        )
      )
        throw Error("Unexpected inventory delta.");
      const fileView = (file, bytes, old) => ({
        path: relative(file),
        operation: old ? "replace" : "create",
        oldSha256: old ? digest(old) : null,
        before: old?.toString("utf8") ?? null,
        beforeSize: old?.length ?? 0,
        after: bytes.toString("utf8"),
        size: bytes.length,
        sha256: digest(bytes),
      });
      result.files = [
        fileView(plan.destination, plan.packBytes),
        fileView(plan.ledgerPath, plan.ledgerBytes, plan.ledgerRead.bytes),
      ];
      const evidence = {
        ...binding,
        approval: body.approval,
        approvalSha256: hash(body.approval),
        selected: plan.selected.map((q) => q.id),
        excluded: body.approval.decisions
          .filter((d) => d.outcome === "exclude")
          .map((d) => d.questionId),
        outputs: result.files.map(({ path, sha256 }) => ({ path, sha256 })),
        reconciliation: plan.ledgerReconciliation,
        inventory: { before: counts(before), after: counts(after) },
      };
      result.previewId = hash(evidence);
      result.evidence = evidence;
      result.originals = Object.fromEntries(
        [...files].map(([file, bytes]) => [
          relative(file),
          bytes.toString("base64"),
        ]),
      );
      result.originals["studio/.local/"+id+".json"] = snapshot.stateBytes.toString("base64");
      result.status =
        base.kind === "dev-simulation" ? "simulation" : "preview-ready";
    } catch (error) {
      result.blockers.push(error.message);
    }
  }
  if (result.blockers.length) result.status = "blocked";
  if (
    snapshot.stamp !== capture(repository, id, body.version, options).stamp ||
    (body.expectedPreviewId && body.expectedPreviewId !== result.previewId)
  )
    fail("Preview inputs changed. Calculate again.");
  return { result, snapshot, review, plan };
}
const preview = (repository, id, body) =>
  calculate(repository, id, body).result;
module.exports = { preview, calculate, capture };
