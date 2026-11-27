const fs = require("node:fs");
const path = require("node:path");
const { git, fail } = require("./publicationWorktree");
const { blob, checkTree } = require("./promotionGit");
const { digest, load } = require("./drafts");
const {
  recoveryLock,
} = require("../../server/games/fact-or-cap/publicationTransaction");
const { incoming, directories, ledgers } = require("./inventory");
const { safeFile } = require("./publicationBridge");
const {
  buildQuestionInventory,
} = require("../../server/games/fact-or-cap/questionInventory");
const {
  compareGeneralTopicLedger,
} = require("../../server/games/fact-or-cap/generalTopicLedgerReport");
const {
  loadPublished,
  makeAnimeLedgerUpdate,
} = require("../../server/games/fact-or-cap/publicationPlan");
function integrated(root, commit, record) {
  checkTree(root, commit, record);
  const values = new Map(),
    listing = new Map(),
    dirs = {};
  for (const key of ["general", "anime"]) {
    const dir = directories[key],
      abs = path.join(root, dir);
    dirs[key === "anime" ? "fact-or-cap-anime" : "fact-or-cap"] = abs;
    const names = git(root, ["ls-tree", "-z", commit + ":" + dir])
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const [meta, name] = entry.split("\t");
        if (
          name.endsWith(".json") &&
          (!meta.startsWith("100644 blob ") || !/^[^/\\:]+\.json$/.test(name))
        )
          fail("Unsafe content tree.");
        return name;
      })
      .filter((n) => n.endsWith(".json"));
    listing.set(abs, names);
    for (const name of names)
      values.set(
        path.join(abs, name),
        blob(root, commit + ":" + dir + "/" + name),
      );
  }
  const reader = {
    readdirSync: (d) => [...listing.get(d)],
    readFileSync: (f, enc) =>
      enc ? values.get(f).toString(enc) : values.get(f),
  };
  const inventory = buildQuestionInventory({
    contentDirectories: dirs,
    fileSystem: reader,
  });
  if (inventory.hasErrors) fail("Integrated bank inventory failed validation.");
  const r = record.receipt,
    ledger = JSON.parse(blob(root, commit + ":" + ledgers[r.target]));
  const pack = JSON.parse(blob(root, commit + ":" + record.files[0]));
  if (
    pack.contentPackId !== r.packId ||
    JSON.stringify(pack.questions.map((q) => q.id)) !==
      JSON.stringify(r.selected)
  )
    fail("Integrated selection differs from receipt.");
  const dir = path.join(root, directories[r.target]);
  if (r.target === "general") {
    if (
      !compareGeneralTopicLedger({
        ledger,
        contentDirectory: dir,
        fileSystem: reader,
      }).reconciliation.valid
    )
      fail("Integrated General ledger failed reconciliation.");
  } else {
    const loaded = loadPublished(dir, reader);
    const result = makeAnimeLedgerUpdate(
      ledger,
      { manifestVersion: 1, franchises: [], entries: [] },
      { contentPackId: "unused", questions: [] },
      loaded.packs,
    );
    if (loaded.errors.length || result.errors.length)
      fail("Integrated Anime ledger failed reconciliation.");
  }
  return {
    status: "integrated",
    devCommit: commit,
    transactionId: r.transactionId,
    selected: r.selected,
  };
}
// Move each original to a private, hash-checked holding area before deleting it.
// The manifest survives interruption, including after deletion of the very last original.
function cleanupOriginals(repository, record) {
  const r = record.receipt;
  if (r.excluded.length)
    fail("Retain originals containing excluded questions.");
  const local = path.join(repository, "studio", ".local");
  const dir = path.join(local, "cleanup-" + r.transactionId);
  const marker = path.join(dir, "manifest.json"),
    done = path.join(dir, "complete");
  const items = [
    [r.filename, r.candidateSha256],
    [r.sideName, r.sidecarSha256],
  ];
  if (
    new Set(items.map((i) => i[0])).size !== 2 ||
    items.some(
      ([name, sha]) =>
        typeof name !== "string" ||
        !/^[^/\\:\x00-\x1f]+\.json$/.test(name) ||
        !/^[a-f0-9]{64}$/.test(sha),
    )
  )
    fail("Invalid original bindings.");
  const expected = JSON.stringify(items);
  safeFile(marker);
  safeFile(done);
  const paths = items.map(([name, sha], i) => ({
    original: path.join(repository, incoming, name),
    held: path.join(dir, "original-" + i),
    sha,
  }));
  const verify = (file, sha) => {
    safeFile(file);
    if (digest(fs.readFileSync(file)) !== sha)
      fail("Incoming bytes changed; originals retained.");
  };
  if (!fs.existsSync(dir)) {
    if (digest(r.filename) !== r.draftId)
      fail("Receipt draft identity mismatch.");
    const { view } = load(repository, r.draftId);
    if (view.version !== r.version || view.sideName !== r.sideName)
      fail("Incoming bytes changed or editorial review was superseded.");
    for (const item of paths) verify(item.original, item.sha);
    fs.mkdirSync(dir);
    fs.writeFileSync(marker, expected, { flag: "wx", flush: true });
  }
  if (!fs.existsSync(marker) || fs.readFileSync(marker, "utf8") !== expected)
    fail("Cleanup manifest is incomplete or changed.");
  if (fs.existsSync(done)) {
    if (
      fs.readFileSync(done, "utf8") !== "complete" ||
      paths.some((i) => fs.existsSync(i.original) || fs.existsSync(i.held))
    )
      fail("Cleanup completion conflicts with current originals.");
    return { status: "already-cleaned" };
  }
  const verified = path.join(dir, "verified");
  safeFile(verified);
  const readyToDelete = fs.existsSync(verified);
  if (readyToDelete && fs.readFileSync(verified, "utf8") !== expected)
    fail("Invalid cleanup evidence.");
  for (const item of paths) {
    safeFile(item.original);
    safeFile(item.held);
    if (readyToDelete && fs.existsSync(item.original))
      fail("Original was recreated during cleanup.");
    if (fs.existsSync(item.held)) {
      verify(item.held, item.sha);
      if (fs.existsSync(item.original))
        fail("Original was recreated during cleanup.");
    } else if (fs.existsSync(item.original)) verify(item.original, item.sha);
    else if (!readyToDelete)
      fail("Original disappeared before cleanup verification.");
  }
  if (!readyToDelete) {
    for (const item of paths) {
      if (fs.existsSync(item.held)) continue;
      fs.renameSync(item.original, item.held);
      verify(item.held, item.sha);
    }
  }
  if (paths.some((item) => fs.existsSync(item.original)))
    fail("Original was recreated during cleanup.");
  if (!fs.existsSync(verified))
    fs.writeFileSync(verified, expected, { flag: "wx", flush: true });
  if (fs.readFileSync(verified, "utf8") !== expected)
    fail("Invalid cleanup evidence.");
  for (const item of paths)
    if (fs.existsSync(item.held)) {
      verify(item.held, item.sha);
      fs.unlinkSync(item.held);
    }
  fs.writeFileSync(done, "complete", { flag: "wx", flush: true });
  return { status: "cleaned" };
}
function cleanup(repository, record) {
  const lock = path.join(
    repository,
    "studio",
    ".local",
    "publication-cleanup.lock",
  );
  safeFile(lock);
  const fd = recoveryLock(fs, lock);
  try {
    return cleanupOriginals(repository, record);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
module.exports = { integrated, cleanup };
