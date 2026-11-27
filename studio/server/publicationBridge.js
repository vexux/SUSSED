const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  baseline,
  game,
  transactionDir,
  fail,
  git,
} = require("./publicationWorktree");
const { calculate, capture } = require("./publicationPreview");
const { directories, ledgers, incoming, read } = require("./inventory");
const { digest } = require("./drafts");
const {
  publishBatch,
} = require("../../server/games/fact-or-cap/contentPublication");

function pathsFor(root) {
  return {
    generalLedger: path.join(root, ledgers.general),
    animeLedger: path.join(root, ledgers.anime),
    trackedReceiptDirectory: path.join(
      root,
      game,
      "research",
      "publication-receipts",
    ),
    temporaryEvidenceDirectory: path.join(
      fs.realpathSync.native(os.tmpdir()),
      "sussed-publication-" + digest(root),
    ),
    incomingDirectory: path.join(root, incoming),
    transactionDirectory: transactionDir(root),
  };
}
function safeFile(file) {
  for (let p = file; ; p = path.dirname(p)) {
    const stat = fs.lstatSync(p, { throwIfNoEntry: false });
    if (
      stat &&
      (fs.realpathSync.native(p) !== p || (p !== file && !stat.isDirectory()))
    )
      fail("Linked or unexpected publication path.");
    if (stat || path.dirname(p) === p) break;
  }
}
function readReceipt(root, id) {
  if (!/^[a-f0-9]{64}$/.test(id)) fail("Invalid transaction ID.", 400);
  const file = path.join(pathsFor(root).trackedReceiptDirectory, id + ".json");
  safeFile(file);
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  const receipt = JSON.parse(bytes);
  const target = receipt.target;
  if (
    receipt.schema !== 1 ||
    receipt.transactionId !== id ||
    !["anime", "general"].includes(target) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(receipt.packId) ||
    !Array.isArray(receipt.selected) ||
    !/^[a-f0-9]{40,64}$/.test(receipt.baseline)
  )
    fail("Invalid tracked receipt.");
  const pack = directories[target] + "/" + receipt.packId + ".json";
  if (
    digest(read(root, pack)) !== receipt.packSha256 ||
    digest(read(root, ledgers[target])) !== receipt.ledgerSha256
  )
    fail("Published files have changed since this transaction.");
  return {
    receipt,
    files: [
      pack,
      ledgers[target],
      game + "/research/publication-receipts/" + id + ".json",
    ],
    hashes: [receipt.packSha256, receipt.ledgerSha256, digest(bytes)],
  };
}
function publish(repository, id, body) {
  const { version, approval, expectedPreviewId, confirmation } = body ?? {};
  if (
    Object.keys(body ?? {}).some(
      (k) =>
        !["version", "approval", "expectedPreviewId", "confirmation"].includes(
          k,
        ),
    ) ||
    !/^[a-f0-9]{64}$/.test(expectedPreviewId) ||
    confirmation !== "publish " + expectedPreviewId
  )
    fail("Explicit confirmation for this preview is required.", 400);
  const base = baseline(repository);
  if (base.kind !== "data-worktree")
    fail("Publication requires a dedicated data worktree.");
  const paths = pathsFor(base.root);
  for (const dir of Object.values(paths)) safeFile(dir);
  if (fs.existsSync(paths.transactionDirectory))
    fail("Pending publication transaction. Inspect recovery first.");
  const previous = readReceipt(base.root, expectedPreviewId);
  if (previous) {
    if (
      previous.receipt.draftId !== id ||
      previous.receipt.version !== version ||
      previous.receipt.approvalSha256 !== digest(JSON.stringify(approval))
    )
      fail("Different publication request.");
    return { status: "already-published", receipt: previous.receipt };
  }
  // One publication at a time. A later ledger update must not strand an earlier promotion.
  const receipts = git(base.root, [
    "ls-tree",
    "--name-only",
    "HEAD",
    "--",
    game + "/research/publication-receipts",
  ]);
  if (
    receipts.trim() &&
    git(base.root, ["merge-base", base.commit, "refs/heads/dev"]).trim() !==
      base.commit
  )
    fail(
      "Integrate the previous data publication and refresh local dev before publishing another.",
    );
  const { result, snapshot, plan, review } = calculate(repository, id, {
    version,
    approval,
    expectedPreviewId,
  });
  if (result.status !== "preview-ready" || snapshot.base.root !== base.root)
    fail("A fresh data-worktree preview is required.");
  const evidence = result.evidence;
  const tracked = {
    schema: 1,
    transactionId: expectedPreviewId,
    draftId: id,
    version,
    baseline: base.commit,
    branch: "data",
    implementation: base.implementation,
    publishedAt: new Date().toISOString(),
    target: snapshot.v.target,
    packId: snapshot.v.packId,
    filename: snapshot.v.filename,
    sideName: snapshot.v.sideName,
    candidateSha256: snapshot.v.candidateHash,
    sidecarSha256: snapshot.v.metadataHash,
    approvalSha256: evidence.approvalSha256,
    reviewer: approval.reviewerId,
    editorialReviewer: evidence.editorial.reviewer,
    editorialAt: evidence.editorial.at,
    selected: evidence.selected,
    excluded: evidence.excluded,
    packSha256: plan.packSha256,
    ledgerSha256: plan.ledgerSha256,
    previousLedgerSha256: digest(plan.ledgerRead.bytes),
  };
  const check = () => {
    const fresh = capture(repository, id, version, { locked: true });
    if (fresh.base?.root !== base.root || fresh.stamp !== snapshot.stamp)
      fail("Publication inputs changed.");
  };
  const checkApplied = () => {
    const fresh = capture(repository, id, version, {
      locked: true,
      applied: true,
    });
    if (!fresh.binding || fresh.base.root !== base.root)
      fail("Publication baseline changed.");
    const inputs = new Map(
      snapshot.binding.inputs.map((item) => [item.path, item.sha256]),
    );
    for (const file of result.files) inputs.set(file.path, file.sha256);
    if (
      inputs.size !== fresh.binding.inputs.length ||
      fresh.binding.inputs.some(
        (item) => inputs.get(item.path) !== item.sha256,
      ) ||
      fresh.binding.version !== snapshot.binding.version ||
      JSON.stringify(fresh.binding.baseline) !==
        JSON.stringify(snapshot.binding.baseline)
    )
      fail("Inputs changed while installing the publication.");
  };
  publishBatch({
    review,
    approval,
    checkApplied,
    classificationManifest: snapshot.v.metadata,
    animeFranchiseManifest: snapshot.v.metadata,
    contentDirectories: snapshot.args.contentDirectories,
    paths,
    tracked,
    check,
    sourcePath: path.join(repository, incoming, snapshot.v.filename),
  });
  return { status: "published", receipt: tracked };
}
module.exports = { pathsFor, readReceipt, publish, safeFile };
