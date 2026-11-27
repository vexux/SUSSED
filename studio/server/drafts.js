const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { decodeUtf8 } = require("../../server/content/textIntegrity");
const { safePath, read, incoming, ledgers } = require("./inventory");
const { structure, validate } = require("./draftValidation");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const checklist = [
  "Factual accuracy",
  "Source credibility and exact claim support",
  "Attribution and evidence locator",
  "Copyright and intended reuse",
  "Semantic overlap and question quality",
  "Repetition and variety",
  "Metadata correctness",
];
function reject(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function exactDirectory(dir) {
  if (fs.realpathSync.native(dir) !== dir || !fs.lstatSync(dir).isDirectory())
    reject("Linked directory refused");
}
function stateDir(root, create = false) {
  const studio = path.join(root, "studio");
  exactDirectory(studio);
  const dir = path.join(studio, ".local");
  if (create && !fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
  if (fs.existsSync(dir)) exactDirectory(dir);
  return dir;
}
function optionalBytes(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  if (
    !stat.isFile() ||
    fs.realpathSync.native(file) !== file ||
    stat.size > 16 * 1024 * 1024
  )
    reject("Unsafe or oversized file");
  return fs.readFileSync(file);
}
function atomic(file, value, check, expectedHash) {
  const dir = path.dirname(file);
  exactDirectory(dir);
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  if (bytes.length > 16 * 1024 * 1024)
    reject("File exceeds the Studio size limit.");
  const temp = path.join(dir, ".studio-" + randomUUID() + ".tmp");
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    exactDirectory(dir);
    check();
    exactDirectory(dir);
    const current = optionalBytes(file);
    if ((current === null ? null : digest(current)) !== expectedHash)
      reject("File changed during save. Reload and reconcile.", 409);
    if (expectedHash === null)
      fs.linkSync(temp, file); // Exclusive creation, including when a different editor adds a sidecar.
    else fs.renameSync(temp, file);
  } finally {
    exactDirectory(dir);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function json(bytes, label) {
  return JSON.parse(decodeUtf8(bytes, label));
}
function load(repository, id, proposedTarget) {
  const root = fs.realpathSync.native(repository);
  if (!/^[0-9a-f]{64}$/.test(id)) reject("Invalid draft ID");
  const dir = safePath(root, incoming);
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  const file = files.find((n) => digest(n) === id);
  if (!file) reject("Candidate no longer exists", 404);
  const bytes = read(root, path.join(incoming, file)),
    pack = json(bytes, file);
  if (typeof pack?.contentPackId !== "string" || !Array.isArray(pack.questions))
    reject("Expected a readable incoming candidate");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(pack.contentPackId))
    reject("Invalid candidate pack ID");
  const local = stateDir(root);
  const stateFile = path.join(local, id + ".json");
  const stored = optionalBytes(stateFile);
  const state = stored
    ? json(stored, stateFile)
    : { target: null, reviews: [] };
  const base = pack.contentPackId;
  const anime = base + "-franchises.json",
    general = base + "-classifications.json";
  const generalNames = new Set();
  let samePack = 0;
  for (const n of files) {
    if (n === general) generalNames.add(n);
    let value;
    try {
      value = json(read(root, path.join(incoming, n)), n);
    } catch {
      continue;
    }
    if (value?.contentPackId === base && Array.isArray(value.questions))
      samePack++;
    if (
      value?.manifestVersion === 1 &&
      value.classifications?.length &&
      Array.isArray(value.classifications) &&
      value.classifications.every((c) => c?.contentPackId === base)
    )
      generalNames.add(n);
  }
  const target = Object.hasOwn(pack, "packType")
    ? "bruh"
    : (proposedTarget ??
      state.target ??
      (files.includes(anime) === !!generalNames.size
        ? null
        : files.includes(anime)
          ? "anime"
          : "general"));
  const sideName =
    target === "anime"
      ? anime
      : target === "general"
        ? ([...generalNames][0] ?? general)
        : null;
  if (target === "general" && generalNames.size > 1)
    reject("Ambiguous classification sidecars; reconcile the inbox first.");
  let sideBytes = null,
    metadata = null,
    metadataIssue = null;
  if (sideName) {
    if (sideName === file)
      reject("Candidate filename collides with its sidecar");
    // lstat includes dangling links: a link must never be treated as an absent sidecar.
    if (optionalBytes(path.join(dir, sideName)) !== null) {
      sideBytes = read(root, path.join(incoming, sideName));
      try {
        metadata = json(sideBytes, sideName);
        if (
          metadata?.manifestVersion !== 1 ||
          Object.hasOwn(metadata, "questions") ||
          !Array.isArray(
            target === "anime" ? metadata.entries : metadata.classifications,
          )
        )
          throw new Error("Unexpected manifest schema");
        if (
          target === "general" &&
          metadata.classifications.some(
            (c) => c?.contentPackId && c.contentPackId !== base,
          )
        )
          throw new Error("Contains assignments for a different pack");
      } catch (error) {
        metadataIssue =
          "Sidecar requires external reconciliation: " + error.message;
      }
    }
  }
  const binding = {
    filename: file,
    packId: base,
    target,
    sideName,
    candidateHash: digest(bytes),
    metadataHash: sideBytes ? digest(sideBytes) : null,
  };
  const version = digest(
    JSON.stringify([binding, stored ? digest(stored) : null]),
  );
  const history = state.reviews.map((r) => ({
    ...r,
    current: Object.keys(binding).every((k) => r[k] === binding[k]),
  }));
  return {
    root,
    dir,
    stateFile,
    state,
    stateHash: stored ? digest(stored) : null,
    samePack,
    view: {
      ...binding,
      id,
      version,
      pack,
      metadata,
      metadataIssue,
      history,
      checklist,
    },
  };
}
function workspace(repository, id) {
  const { view, root } = load(repository, id);
  if (view.target === "general" || view.target === "anime") {
    try {
      const ledger = json(read(root, ledgers[view.target]), "Research ledger");
      view.reference =
        view.target === "general"
          ? {
              topics: ledger.taxonomy,
              questionTypes: ledger.classificationConventions.questionTypes,
            }
          : ledger.franchises.map(({ franchiseId, displayName, aliases }) => ({
              franchiseId,
              displayName,
              aliases,
            }));
    } catch {
      view.reference =
        "Ledger unavailable. Check the library before completing review.";
    }
  }
  return view;
}
function operation(repository, id, action, body) {
  const allowed = {
    target: ["target"],
    candidate: ["pack"],
    metadata: ["metadata"],
    validate: ["pack", "metadata"],
    review: ["reviewer", "decision", "checks", "notes"],
  };
  if (
    !Object.hasOwn(allowed, action) ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) => k !== "version" && !allowed[action].includes(k),
    ) ||
    allowed[action].some((k) => !Object.hasOwn(body, k))
  )
    reject("Invalid request fields");
  const check = () => {
    const loaded = load(repository, id);
    if (body.version !== loaded.view.version)
      reject("Draft changed. Reload and reconcile your edits.", 409);
    return loaded;
  };
  const { root, dir, stateFile, state, stateHash, samePack, view } = check();
  if (action === "validate") {
    const report = validate(
      root,
      view.filename,
      view.target,
      body.pack,
      body.metadata,
    );
    if (view.metadataIssue) report.metadataErrors.push(view.metadataIssue);
    return report;
  }
  const local = stateDir(root, true);
  const lock = path.join(local, "draft-write.lock");
  let fd;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST")
      reject("Another Studio write is locked. Retry after it finishes.", 409);
    throw e;
  }
  try {
    check();
    if (action === "target") {
      if (view.target === "bruh" || !["general", "anime"].includes(body.target))
        reject("Choose a Fact or Cap target");
      load(root, id, body.target); // Resolve the new sidecar before changing the stored association.
      state.target = body.target;
    } else if (action === "candidate") {
      const p = body.pack;
      if (
        !view.target ||
        !p ||
        p.contentPackId !== view.packId ||
        Object.hasOwn(p, "packType") !== (view.target === "bruh")
      )
        reject("Candidate identity and schema must be preserved.");
      const { questions: beforeRows, ...beforeHeader } = view.pack;
      const { questions: afterRows, ...afterHeader } = p;
      if (!require("node:util").isDeepStrictEqual(beforeHeader, afterHeader))
        reject("Only candidate questions may change.");
      const issues = structure(p, view.target).errors;
      if (issues.length) reject(issues.join("\n"));
      atomic(path.join(dir, view.filename), p, check, view.candidateHash);
    } else if (action === "metadata") {
      if (view.metadataIssue) reject(view.metadataIssue);
      if (body.metadata && Object.hasOwn(body.metadata, "questions"))
        reject("A candidate cannot be saved as a sidecar.");
      if (!view.sideName || samePack !== 1)
        reject("A unique Fact or Cap candidate and target are required.");
      const issues = validate(
        root,
        view.filename,
        view.target,
        view.pack,
        body.metadata,
      );
      if (
        issues.errors.length &&
        !issues.metadataErrors.length &&
        structure(view.pack, view.target).errors.length
      )
        reject("Fix candidate structure first.");
      if (!body.metadata || issues.metadataErrors.length)
        reject(issues.metadataErrors.join("\n") || "Missing metadata.");
      atomic(
        path.join(dir, view.sideName),
        body.metadata,
        check,
        view.metadataHash,
      );
    } else {
      if (
        !view.target ||
        !["reviewed", "needs-changes"].includes(body.decision) ||
        typeof body.notes !== "string" ||
        !body.notes.trim() ||
        body.notes.length > 8000 ||
        typeof body.reviewer !== "string" ||
        !body.reviewer.trim() ||
        body.reviewer.length > 120 ||
        !Array.isArray(body.checks) ||
        body.checks.some((k) => !checklist.includes(k)) ||
        new Set(body.checks).size !== body.checks.length
      )
        reject(
          "A valid decision, checklist, reviewer and rationale are required.",
        );
      if (body.decision === "reviewed") {
        if (view.metadataIssue) reject(view.metadataIssue);
        const report = validate(
          root,
          view.filename,
          view.target,
          view.pack,
          view.metadata,
        );
        if (
          report.errors.length ||
          report.metadataErrors.length ||
          body.checks.length !== checklist.length
        )
          reject(
            "Resolve validation errors and complete all editorial checks first.",
          );
      }
      const {
        filename,
        packId,
        target,
        sideName,
        candidateHash,
        metadataHash,
      } = view;
      state.reviews.push({
        filename,
        packId,
        target,
        sideName,
        candidateHash,
        metadataHash,
        reviewer: body.reviewer.trim(),
        notes: body.notes.trim(),
        decision: body.decision,
        checks: body.checks,
        at: new Date().toISOString(),
      });
    }
    if (action === "target" || action === "review")
      atomic(stateFile, state, check, stateHash);
    return workspace(root, id);
  } finally {
    fs.closeSync(fd);
    exactDirectory(local);
    fs.unlinkSync(lock);
  }
}
module.exports = { digest, workspace, operation };
