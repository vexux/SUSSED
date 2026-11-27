const fs = require("node:fs");
const path = require("node:path");
const {
  git,
  baseline,
  head,
  status,
  game,
  fail,
} = require("./publicationWorktree");
const { pathsFor, readReceipt, safeFile } = require("./publicationBridge");
const { digest } = require("./drafts");
const promotion = require("./promotionGit");
const { integrated, cleanup } = require("./publicationIntegration");
const { directories } = require("./inventory");
const manual = "https://github.com/vexux/SUSSED/compare/dev...data";
const actions = [
  "inspect",
  "progress",
  "setup",
  "recover",
  "commit",
  "push",
  "pr",
  "merge",
  "verify",
  "cleanup",
];
function workflow(repository, body, deps = {}) {
  if (
    !body ||
    !actions.includes(body.action) ||
    Object.keys(body).some(
      (k) => !["action", "transactionId", "confirmation"].includes(k),
    )
  )
    fail("Invalid promotion request.", 400);
  const { action, transactionId, confirmation } = body,
    base = baseline(repository);
  const root = base.root,
    paths = pathsFor(root),
    call = deps.github ?? promotion.github;
  const describe = (details, run) => {
    const actionId = digest(
      JSON.stringify([action, transactionId, base.kind, base.commit, details]),
    );
    if (confirmation === undefined)
      return { status: "confirmation-required", action, actionId, details };
    if (confirmation !== actionId)
      fail("Action state changed. Inspect and confirm again.");
    return run();
  };
  if (action === "inspect") {
    const dir = paths.trackedReceiptDirectory;
    safeFile(dir);
    const transactions = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
          .map((n) => n.slice(0, -5))
      : [];
    return {
      status: "workspace",
      baseline: base.kind,
      head: base.commit,
      worktree: root,
      transactions,
      pendingRecovery: fs.existsSync(paths.transactionDirectory),
      manual,
    };
  }
  if (action === "setup") {
    if (base.kind === "data-worktree")
      return { status: "worktree-ready", worktree: root };
    const url = promotion.origin(root, deps.acceptOrigin),
      refs = promotion.remoteRefs(root, url);
    return describe(
      {
        destination: root + "-data",
        expectedDev: head(root),
        remote: refs,
        branch: "data",
      },
      () => {
        const worktree = promotion.setup(root, base.commit, refs, url);
        if (baseline(repository).root !== fs.realpathSync.native(worktree))
          fail("Worktree registration requires inspection.");
        return { status: "worktree-ready", worktree };
      },
    );
  }
  if (base.kind !== "data-worktree")
    fail("Set up the dedicated data worktree first.");
  if (action === "recover") {
    const journal = path.join(paths.transactionDirectory, "transaction.json");
    safeFile(journal);
    if (!fs.existsSync(paths.transactionDirectory)) return { status: "idle" };
    if (!fs.existsSync(journal))
      fail(
        "Recovery directory without journal. Inspect manually and preserve its contents.",
      );
    return describe(
      {
        worktree: root,
        journalSha256: digest(fs.readFileSync(journal)),
        operation:
          "Verify transaction artifacts and finish cleanup or roll back prepared outputs.",
      },
      () =>
        require("../../server/games/fact-or-cap/publicationTransaction").recoverPublication(
          {
            paths,
            contentDirectories: {
              "fact-or-cap": path.join(root, directories.general),
              "fact-or-cap-anime": path.join(root, directories.anime),
            },
          },
        ),
    );
  }
  if (fs.existsSync(paths.transactionDirectory))
    fail("Resolve the pending publication transaction first.");
  const record = readReceipt(root, transactionId);
  if (!record) fail("No tracked publication receipt for this transaction.");
  const { receipt, files, hashes } = record;
  const current = head(root);
  if (action === "progress") {
    if (current === receipt.baseline)
      return { status: "published-awaiting-commit", files };
    promotion.verifyCommit(root, current, record);
    const remote = promotion.remoteRefs(
      root,
      promotion.origin(root, deps.acceptOrigin),
    );
    const devAvailable = promotion.hasCommit(root, remote.dev);
    if (
      devAvailable &&
      git(root, ["merge-base", current, remote.dev]).trim() === current
    )
      return {
        ...integrated(root, remote.dev, record),
        cleanupState: fs.existsSync(
          path.join(
            repository,
            "studio",
            ".local",
            "cleanup-" + transactionId,
            "complete",
          ),
        )
          ? "completed"
          : "available",
      };
    if (!devAvailable && remote.data !== current)
      return {
        status: "verify-remote-dev",
        commit: current,
        remote,
        message: "Remote dev has advanced. Verify integration before retrying a push.",
      };
    if (remote.data !== current)
      return { status: "committed-awaiting-push", commit: current, remote };
    const pr = promotion.pull(root, current, deps.github);
    return {
      status: pr?.merged_at
        ? "merged-awaiting-verification"
        : pr
          ? "pr-open"
          : "pushed-awaiting-pr",
      commit: current,
      pr: pr?.html_url,
      manual,
    };
  }
  if (action === "commit" && current === receipt.baseline) {
    const anchor = path.join(
      paths.temporaryEvidenceDirectory,
      receipt.packId + ".json",
    );
    safeFile(anchor);
    if (
      !fs.existsSync(anchor) ||
      JSON.parse(fs.readFileSync(anchor)).trackedSha256 !== hashes[2]
    )
      fail(
        "Local publisher evidence for the tracked receipt is missing or changed. Inspect before committing.",
      );
    const changes = status(root).split("\0").filter(Boolean);
    if (
      JSON.stringify(changes.map((r) => r.slice(3)).sort()) !==
      JSON.stringify([...files].sort())
    )
      fail(
        "Unexpected changed paths. Keep only the pack, ledger and tracked receipt.",
      );
    const fingerprint = git(root, [
      "diff",
      "--cached",
      "--raw",
      "--no-abbrev",
      current,
    ]);
    return describe(
      {
        branch: "data",
        parent: current,
        paths: files,
        sha256: hashes,
        index: fingerprint,
      },
      () => ({
        status: "committed",
        commit: promotion.commitPublication(root, record),
      }),
    );
  }
  if (status(root)) fail("Data worktree or index has unexpected changes.");
  promotion.verifyCommit(root, current, record);
  if (action === "commit")
    return { status: "already-committed", commit: current };
  const url = promotion.origin(root, deps.acceptOrigin),
    remote = promotion.remoteRefs(root, url);
  const details = {
    commit: current,
    remote,
    paths: files,
    sha256: hashes,
    base: "dev",
    head: "data",
  };
  if (action === "push") {
    if (remote.data === current)
      return { status: "already-pushed", commit: current };
    if (remote.data && remote.data !== receipt.baseline)
      fail("Remote data diverged; inspect before pushing.");
    return describe(
      { ...details, refspec: current + ":refs/heads/data" },
      () => {
        promotion.obtain(root, url, remote.dev);
        integrated(
          root,
          promotion.verifyProposal(root, remote.dev, current, record),
          record,
        );
        // Explicit URL, pinned object and exact lease. The parent check above forbids non-fast-forwards.
        git(root, [
          "push",
          "--no-follow-tags",
          "--force-with-lease=refs/heads/data:" + (remote.data ?? ""),
          url,
          current + ":refs/heads/data",
        ]);
        if (promotion.remoteRefs(root, url).data !== current)
          fail("Push outcome uncertain. Inspect remote data.");
        return { status: "pushed", commit: current };
      },
    );
  }
  if (action === "verify" || action === "cleanup") {
    return describe(
      {
        ...details,
        originals:
          action === "cleanup"
            ? [receipt.filename, receipt.sideName]
            : undefined,
      },
      () => {
        promotion.obtain(root, url, remote.dev);
        if (git(root, ["merge-base", current, remote.dev]).trim() !== current)
          fail("Published commit is not integrated into remote dev.");
        const result = integrated(root, remote.dev, record);
        if (promotion.remoteRefs(root, url).dev !== remote.dev)
          fail("Remote dev changed during verification.");
        return action === "verify" ? result : cleanup(repository, record);
      },
    );
  }
  if (remote.data !== current)
    fail("Verify that the exact data commit is pushed first.");
  const info = promotion.pull(root, current, call);
  if (info?.merged_at)
    return {
      status: "merged-awaiting-verification",
      commit: current,
      pr: info.html_url,
    };
  if (action === "pr" && info)
    return { status: "existing-pr", pr: info.html_url };
  if (
    action === "merge" &&
    (!info ||
      info.state !== "open" ||
      info.mergeable !== true ||
      info.draft ||
      info.base.sha !== remote.dev)
  )
    fail(
      "A current open, mergeable non-draft PR into dev is required. Refresh after GitHub computes mergeability.",
    );
  return describe(
    {
      ...details,
      pr: info?.number ?? null,
      operation:
        action === "pr"
          ? "Open GitHub pull request"
          : "Merge this pull request",
    },
    () => {
      promotion.obtain(root, url, remote.dev);
      integrated(
        root,
        promotion.verifyProposal(root, remote.dev, current, record),
        record,
      );
      const endpoint = "repos/" + promotion.repo + "/pulls";
      const fresh = promotion.remoteRefs(root, url);
      if (fresh.dev !== remote.dev || fresh.data !== current)
        fail("Remote changed before GitHub action.");
      if (action === "pr") {
        const pr = JSON.parse(
          call(root, [
            "-X",
            "POST",
            endpoint,
            "-f",
            "head=data",
            "-f",
            "base=dev",
            "-f",
            "title=Publish " + receipt.packId,
            "-f",
            "body=Studio transaction " + transactionId + " at " + current,
          ]),
        );
        return { status: "pr-open", pr: pr.html_url };
      }
      const merged = JSON.parse(
        call(root, [
          "-X",
          "PUT",
          endpoint + "/" + info.number + "/merge",
          "-f",
          "sha=" + current,
          "-f",
          "merge_method=merge",
        ]),
      );
      if (!merged.merged) fail("GitHub did not confirm merge. Inspect the PR.");
      const dev = promotion.remoteRefs(root, url).dev;
      promotion.obtain(root, url, dev);
      if (git(root, ["merge-base", current, dev]).trim() !== current)
        fail("Merge reported, but remote dev ancestry is unverified.");
      return { ...integrated(root, dev, record), pr: info.html_url };
    },
  );
}
module.exports = { workflow };
