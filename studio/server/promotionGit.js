const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { git, head, status, fail } = require("./publicationWorktree");
const { digest } = require("./drafts");

const remotePattern =
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)vexux\/SUSSED(?:\.git)?$/i;
function origin(root, accepts = (value) => remotePattern.test(value)) {
  const fetch = git(root, ["remote", "get-url", "--all", "origin"]).trim();
  const push = git(root, [
    "remote",
    "get-url",
    "--push",
    "--all",
    "origin",
  ]).trim();
  if (push !== fetch || !accepts(fetch))
    fail("Expected one matching fetch and push URL for vexux/SUSSED.");
  return fetch;
}
function remoteRefs(root, url) {
  const rows = git(root, [
    "ls-remote",
    "--heads",
    url,
    "refs/heads/data",
    "refs/heads/dev",
  ]).trim();
  const refs = Object.fromEntries(
    rows
      .split("\n")
      .filter(Boolean)
      .map((row) => {
        const [oid, name] = row.trim().split(/\s+/);
        if (!/^[a-f0-9]{40,64}$/.test(oid)) fail("Invalid remote revision.");
        return [name, oid];
      }),
  );
  if (!refs["refs/heads/dev"]) fail("Remote dev branch unavailable.");
  return { data: refs["refs/heads/data"] ?? null, dev: refs["refs/heads/dev"] };
}
function hasCommit(root, oid) {
  try {
    git(root, ["rev-parse", "--verify", "--quiet", oid + "^{commit}"]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}
function obtain(root, url, oid) {
  if (!hasCommit(root, oid)) {
    git(root, [
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      "--refmap=",
      url,
      oid,
    ]);
  }
}
function samePaths(actual, expected) {
  if (
    JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())
  )
    fail("File list differs from the three approved publication paths.");
}
function names(root, args) {
  return git(root, args).split("\0").filter(Boolean);
}
function blob(root, spec) {
  return git(root, ["cat-file", "blob", spec], { encoding: null });
}
function checkTree(root, tree, record) {
  for (const [i, file] of record.files.entries()) {
    const entry = git(root, ["ls-tree", tree, "--", file]);
    if (
      !entry.startsWith("100644 blob ") ||
      digest(blob(root, tree + ":" + file)) !== record.hashes[i]
    )
      fail("Unexpected Git object for " + file);
  }
}
function verifyCommit(root, commit, record) {
  if (
    git(root, ["show", "-s", "--format=%P", commit]).trim() !==
    record.receipt.baseline
  )
    fail("Expected one publication commit on its recorded baseline.");
  samePaths(
    names(root, [
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      record.receipt.baseline,
      commit,
    ]),
    record.files,
  );
  checkTree(root, commit, record);
}
function commitPublication(root, record) {
  const base = record.receipt.baseline,
    current = head(root);
  if (current !== base) {
    verifyCommit(root, current, record);
    return current;
  }
  const entries = status(root).split("\0").filter(Boolean);
  if (entries.some((row) => !/^(?:[ AM?][ AM?]) /.test(row)))
    fail("Unexpected rename, deletion or conflict.");
  samePaths(
    entries.map((r) => r.slice(3)),
    record.files,
  );
  for (const file of names(root, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    base,
  ])) {
    const i = record.files.indexOf(file);
    if (i < 0 || digest(blob(root, ":" + file)) !== record.hashes[i])
      fail("Index contains different staged content for " + file);
  }
  git(root, ["add", "--", ...record.files]);
  samePaths(
    names(root, [
      "diff",
      "--cached",
      "--no-renames",
      "--name-only",
      "-z",
      base,
    ]),
    record.files,
  );
  // Pin the verified tree. A concurrent change to the index cannot enter this commit.
  const tree = git(root, ["write-tree"]).trim();
  samePaths(
    names(root, ["diff", "--no-renames", "--name-only", "-z", base, tree]),
    record.files,
  );
  checkTree(root, tree, record);
  const commit = git(root, [
    "commit-tree",
    tree,
    "-p",
    base,
    "-m",
    "Publish " + record.receipt.packId,
  ]).trim();
  verifyCommit(root, commit, record);
  git(root, [
    "update-ref",
    "-m",
    "Studio publication",
    "refs/heads/data",
    commit,
    base,
  ]);
  return commit;
}
function verifyProposal(root, remoteDev, commit, record) {
  const ancestor = git(root, ["merge-base", remoteDev, commit]).trim();
  samePaths(
    names(root, [
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      ancestor,
      commit,
    ]),
    record.files,
  );
  if (
    names(root, [
      "diff",
      "--name-only",
      "-z",
      ancestor,
      remoteDev,
      "--",
      ...record.files,
    ]).length
  )
    fail(
      "Remote dev changed one of the proposed files. Reconcile before promotion.",
    );
  // Git checks the complete merge, including conflicts outside the proposed files.
  const tree = git(root, [
    "merge-tree",
    "--write-tree",
    remoteDev,
    commit,
  ]).trim();
  samePaths(
    names(root, ["diff", "--no-renames", "--name-only", "-z", remoteDev, tree]),
    record.files,
  );
  checkTree(root, tree, record);
  return tree;
}
function setup(root, expected, refs, url) {
  if (head(root) !== expected || refs.dev !== expected)
    fail("Local and remote dev must match the confirmed base.");
  const dest = root + "-data";
  if (fs.lstatSync(dest, { throwIfNoEntry: false }))
    fail("Worktree setup destination already exists: " + dest);
  const local = git(root, [
    "branch",
    "--list",
    "data",
    "--format=%(objectname)",
  ]).trim();
  if (local && local !== (refs.data ?? expected))
    fail("Existing local data branch differs from the verified base.");
  if (refs.data) {
    obtain(root, url, refs.data);
    if (git(root, ["merge-base", refs.data, expected]).trim() !== refs.data)
      fail(
        "Existing remote data has unintegrated work. Register and inspect it separately.",
      );
  }
  git(root, [
    "worktree",
    "add",
    ...(local ? [dest, "data"] : ["-b", "data", dest, refs.data ?? expected]),
  ]);
  return dest;
}
const repo = "vexux/SUSSED";
function github(root, args) {
  try {
    return execFileSync("gh", ["api", "--hostname", "github.com", ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
  } catch (e) {
    throw Error(
      "GitHub request unavailable or rejected. Check gh auth status and repository permissions. Review https://github.com/vexux/SUSSED/compare/dev...data before continuing. " +
        (e.code === "ENOENT" ? "GitHub CLI is unavailable." : ""),
    );
  }
}
function pull(root, commit, call = github) {
  const endpoint = "repos/" + repo + "/pulls";
  const rows = JSON.parse(
    call(root, [endpoint + "?state=all&base=dev&head=vexux:data&per_page=100"]),
  );
  const matches = rows.filter(
    (pr) =>
      pr.base?.ref === "dev" &&
      pr.head?.ref === "data" &&
      pr.head.repo?.full_name === repo &&
      pr.base.repo?.full_name === repo,
  );
  if (matches.some((pr) => pr.state === "open" && pr.head.sha !== commit))
    fail("A different data pull request is open.");
  const pr = matches.find(
    (pr) => pr.head.sha === commit && (pr.state === "open" || pr.merged_at),
  );
  if (!pr) return null;
  const details = JSON.parse(call(root, [endpoint + "/" + pr.number]));
  if (
    details.head.sha !== commit ||
    details.base.ref !== "dev" ||
    details.head.ref !== "data" ||
    details.head.repo?.full_name !== repo ||
    details.base.repo?.full_name !== repo
  )
    fail("Pull request changed. Refresh before continuing.");
  return details;
}
module.exports = {
  origin,
  remoteRefs,
  hasCommit,
  obtain,
  setup,
  commitPublication,
  verifyCommit,
  verifyProposal,
  pull,
  github,
  repo,
  checkTree,
  blob,
};
