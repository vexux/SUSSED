const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function git(root, args, options = {}) {
  return execFileSync(
    "git",
    ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    },
  );
}
function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
function head(root) {
  return git(root, ["rev-parse", "HEAD"]).trim();
}
function branch(root) {
  return git(root, ["branch", "--show-current"]).trim();
}
function status(root) {
  return git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
}
function common(root) {
  return fs.realpathSync.native(
    git(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]).trim(),
  );
}
function baseline(repository) {
  const dev = fs.realpathSync.native(repository);
  if (
    branch(dev) !== "dev" ||
    fs.realpathSync.native(
      git(dev, ["rev-parse", "--show-toplevel"]).trim(),
    ) !== dev
  )
    fail("Studio requires the dev repository root.");
  const rows = git(dev, ["worktree", "list", "--porcelain", "-z"]).split(
    "\0\0",
  );
  const registered = rows
    .map((row) => row.split("\0"))
    .filter((row) => row.includes("branch refs/heads/data"));
  const implementation = head(dev);
  if (!registered.length) {
    const local = git(dev, ["branch", "--list", "data"]).trim();
    return {
      root: dev,
      kind: "dev-simulation",
      commit: implementation,
      implementation,
      note: local
        ? "Local data branch has no registered worktree."
        : "No registered data worktree.",
    };
  }
  if (registered.length !== 1) fail("Ambiguous data worktree registration.");
  const fields = registered[0];
  if (fields.some((f) => /^(prunable|locked)( |$)/.test(f)))
    fail("Data worktree is unavailable or locked.");
  const root = fs.realpathSync.native(fields[0].slice("worktree ".length));
  if (
    root === dev ||
    common(root) !== common(dev) ||
    branch(root) !== "data" ||
    fs.realpathSync.native(
      git(root, ["rev-parse", "--show-toplevel"]).trim(),
    ) !== root
  )
    fail("Data worktree identity changed.");
  const commit = head(root);
  if (!fields.includes("HEAD " + commit)) fail("Data worktree HEAD changed.");
  return { root, kind: "data-worktree", commit, implementation };
}
const game = "server/games/fact-or-cap";
const transactionDir = (root) => path.join(root, game, ".publication-recovery");
module.exports = {
  git,
  branch,
  head,
  status,
  baseline,
  fail,
  game,
  transactionDir,
};
