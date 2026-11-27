const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DEFAULT_PATHS, TARGETS, sha256 } = require("./publicationPlan");

const internal = Symbol("active publisher");
const hex = /^[a-f0-9]{64}$/;
function refuse(message) {
  throw Error(
    message + "; inspect the preserved transaction before continuing.",
  );
}
function exists(io, file) {
  return io.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
}
function safe(io, file) {
  const stat = io.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) {
    if (path.dirname(file) !== file) safe(io, path.dirname(file));
    return;
  }
  if (
    (io.realpathSync.native ?? io.realpathSync)(file) !== path.resolve(file) ||
    stat.isSymbolicLink()
  )
    refuse("Linked publication path " + file);
}
function hash(io, file) {
  safe(io, file);
  return sha256(io.readFileSync(file));
}
function durable(io, dir) {
  // Windows does not expose POSIX directory fsync through Node.
  if (process.platform === "win32") return;
  const fd = io.openSync(dir, "r");
  try {
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
}
function write(io, file, bytes) {
  safe(io, path.dirname(file));
  io.mkdirSync(path.dirname(file), { recursive: true });
  const fd = io.openSync(file, "wx", 0o600);
  try {
    io.writeFileSync(fd, bytes);
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
  durable(io, path.dirname(file));
}
function sameFile(io, left, right) {
  const a = io.statSync(left, { bigint: true }),
    b = io.statSync(right, { bigint: true });
  return a.ino !== 0n && a.ino === b.ino && a.dev === b.dev;
}
function verifyJournal(j, paths, dirs, io) {
  const tx = paths.transactionDirectory;
  const legacy = j?.version === 1;
  const token = path.basename(j?.ledgerBackup?.path ?? "").split(".")[0];
  if (
    (!legacy && j?.version !== 2) ||
    !/^(?:[a-f0-9-]{36}|[a-f0-9]{64})$/.test(token) ||
    !["prepared", "committed"].includes(j.status) ||
    !Array.isArray(j.files) ||
    !(
      j.files.length === 3 ||
      (paths.trackedReceiptDirectory && j.files.length === 4)
    ) ||
    !hex.test(j.ledgerBackup.sha256) ||
    j.ledgerBackup.path !== path.join(tx, token + ".ledger.bak")
  )
    refuse("Invalid recovery journal");
  if (
    !legacy &&
    (j.id !== token ||
      !Number.isSafeInteger(j.pid) ||
      j.pid <= 0 ||
      typeof j.host !== "string")
  )
    refuse("Invalid transaction owner");
  const [pack, ledger, temp, tracked] = j.files;
  const bank = Object.entries(dirs).find(
    ([, dir]) => path.dirname(pack.path) === dir,
  )?.[0];
  const allowedLedger =
    bank === "fact-or-cap"
      ? paths.generalLedger
      : bank === "fact-or-cap-anime"
        ? paths.animeLedger
        : null;
  const evidencePath = path.relative(
    paths.temporaryEvidenceDirectory,
    temp.path,
  );
  if (
    !allowedLedger ||
    !/^[a-z0-9][a-z0-9-]{0,63}\.json$/.test(path.basename(pack.path)) ||
    ledger.path !== allowedLedger ||
    ledger.previousSha256 !== j.ledgerBackup.sha256 ||
    !evidencePath ||
    evidencePath === ".." ||
    evidencePath.startsWith(".." + path.sep) ||
    path.isAbsolute(evidencePath) ||
    (tracked &&
      tracked.path !==
        path.join(paths.trackedReceiptDirectory, token + ".json"))
  )
    refuse("Unexpected journal destinations");
  for (const item of j.files) {
    if (
      item.kind !== (item === ledger ? "replace" : "new") ||
      !hex.test(item.nextSha256) ||
      item.tempPath !==
        path.join(
          path.dirname(item.path),
          "." + path.basename(item.path) + "." + token + ".tmp",
        )
    )
      refuse("Unexpected journal file record");
    safe(io, item.path);
    safe(io, item.tempPath);
  }
  safe(io, j.ledgerBackup.path);
  return { legacy, token, ledger };
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === "ESRCH") return false;
    return true;
  }
}
function recoveryLock(io, lock) {
  const claim = () => {
    const fd = io.openSync(lock, "wx", 0o600);
    try {
      io.writeFileSync(
        fd,
        JSON.stringify({
          host: os.hostname(),
          pid: process.pid,
          nonce: crypto.randomUUID(),
        }),
      );
      io.fsyncSync(fd);
    } catch (error) {
      io.closeSync(fd);
      throw error;
    }
    return fd;
  };
  try {
    return claim();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  safe(io, lock);
  const bytes = io.readFileSync(lock);
  const record = JSON.parse(bytes);
  if (
    record.host !== os.hostname() ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    alive(record.pid)
  )
    refuse("Recovery lock is held or its owner cannot be verified");
  const guard = lock + ".reap";
  const fd = io.openSync(guard, "wx");
  try {
    if (!bytes.equals(io.readFileSync(lock))) refuse("Recovery lock changed");
    io.unlinkSync(lock);
    return claim();
  } finally {
    io.closeSync(fd);
    io.unlinkSync(guard);
  }
}
function recoverPublication({
  paths = DEFAULT_PATHS,
  fileSystem: io = fs,
  contentDirectories = TARGETS,
  owner,
} = {}) {
  const dir = paths.transactionDirectory,
    file = path.join(dir, "transaction.json");
  safe(io, dir);
  if (!exists(io, dir))
    return {
      recovered: false,
      state: "idle",
      message: "No incomplete publication transaction.",
    };
  if (!exists(io, file))
    refuse("No transaction journal exists in the recovery directory");
  safe(io, file);
  const journalBytes = io.readFileSync(file);
  const j = JSON.parse(journalBytes);
  const { legacy, token, ledger } = verifyJournal(
    j,
    paths,
    contentDirectories,
    io,
  );
  if (
    !legacy &&
    owner !== internal &&
    !abandoned.has(file + "\0" + token) &&
    (j.host !== os.hostname() || alive(j.pid))
  )
    refuse("Publisher may still be active");
  // A dead local recovery owner can be reclaimed after rechecking its lock record.
  const lock = path.join(dir, "recover.lock");
  const fd = recoveryLock(io, lock);
  try {
    if (!journalBytes.equals(io.readFileSync(file)))
      refuse("Recovery journal changed");
    const backup = j.ledgerBackup.path,
      committed = j.status === "committed";
    const journalTemp = path.join(dir, "transaction.json." + token + ".tmp");
    const known = new Set([
      "transaction.json",
      "recover.lock",
      path.basename(backup),
      path.basename(journalTemp),
    ]);
    if (io.readdirSync(dir).some((n) => !known.has(n)))
      refuse("Unexpected files in recovery directory");
    if (exists(io, journalTemp)) {
      safe(io, journalTemp);
      const next = { ...j, status: "committed" };
      if (
        io.readFileSync(journalTemp, "utf8") !==
        JSON.stringify(next, null, 2) + "\n"
      )
        refuse("Unexpected staged journal");
    }
    if (exists(io, backup) && hash(io, backup) !== j.ledgerBackup.sha256)
      refuse("Ledger backup changed");
    for (const item of j.files) {
      const staged = exists(io, item.tempPath),
        present = exists(io, item.path);
      if (staged && hash(io, item.tempPath) !== item.nextSha256)
        refuse("Staged output changed: " + item.tempPath);
      const current = present ? hash(io, item.path) : null;
      if (committed) {
        if (current !== item.nextSha256)
          refuse("Committed artifact missing or changed: " + item.path);
      } else if (item === ledger && current === ledger.previousSha256) continue;
      else if (present) {
        if (
          current !== item.nextSha256 ||
          (!legacy && (!staged || !sameFile(io, item.tempPath, item.path)))
        )
          refuse("Unexpected publication artifact: " + item.path);
        if (item === ledger && !exists(io, backup))
          refuse("Ledger backup missing");
      } else if (item === ledger && !exists(io, backup))
        refuse("Ledger and backup both missing");
    }
    // Verify every artifact first so a conflict in the last file cannot partially roll back the first.
    if (!committed)
      for (const item of [...j.files].reverse()) {
        if (
          item === ledger &&
          exists(io, item.path) &&
          hash(io, item.path) === item.previousSha256
        )
          continue;
        const present = exists(io, item.path);
        if (present) {
          if (
            hash(io, item.path) !== item.nextSha256 ||
            (!legacy && !sameFile(io, item.tempPath, item.path))
          )
            refuse("Artifact changed during rollback");
          io.unlinkSync(item.path);
        }
        if (item === ledger) io.linkSync(backup, item.path);
        if (present || item === ledger) durable(io, path.dirname(item.path));
      }
    for (const item of j.files)
      if (exists(io, item.tempPath)) io.unlinkSync(item.tempPath);
    if (exists(io, backup)) io.unlinkSync(backup);
    if (exists(io, journalTemp)) io.unlinkSync(journalTemp);
    io.unlinkSync(file);
  } finally {
    io.closeSync(fd);
    io.unlinkSync(lock);
  }
  io.rmdirSync(dir);
  abandoned.delete(file + "\0" + token);
  durable(io, path.dirname(dir));
  return {
    recovered: j.status !== "committed",
    state: j.status === "committed" ? "committed" : "rolled-back",
    message:
      j.status === "committed"
        ? "Completed publication transaction cleanup."
        : "Rolled back the interrupted publication.",
  };
}

function applyTransaction({
  fileWrites,
  ledgerPath,
  ledgerOldBytes,
  paths = DEFAULT_PATHS,
  fileSystem: io = fs,
  contentDirectories = TARGETS,
  check = () => {},
  checkApplied = () => {},
  transactionId,
}) {
  const id = transactionId ?? crypto.randomUUID(),
    dir = paths.transactionDirectory;
  if (!/^(?:[a-f0-9-]{36}|[a-f0-9]{64})$/.test(id))
    refuse("Invalid transaction ID");
  const journal = path.join(dir, "transaction.json"),
    next = journal + "." + id + ".tmp";
  const backup = path.join(dir, id + ".ledger.bak");
  const files = fileWrites.map((f) => ({
    path: f.path,
    kind: f.kind,
    tempPath: path.join(
      path.dirname(f.path),
      "." + path.basename(f.path) + "." + id + ".tmp",
    ),
    nextSha256: sha256(f.contents),
    ...(f.kind === "replace" ? { previousSha256: sha256(ledgerOldBytes) } : {}),
  }));
  const j = {
    version: 2,
    id,
    pid: process.pid,
    host: os.hostname(),
    status: "prepared",
    files,
    ledgerBackup: { path: backup, sha256: sha256(ledgerOldBytes) },
  };
  verifyJournal(j, paths, contentDirectories, io);
  const verifyOld = () => {
    if (hash(io, ledgerPath) !== j.ledgerBackup.sha256)
      refuse("Publication ledger changed");
    for (const item of files)
      if (item.kind === "new" && exists(io, item.path))
        refuse("Publication destination already exists: " + item.path);
  };
  verifyOld();
  safe(io, dir);
  try {
    io.mkdirSync(dir);
  } catch (e) {
    if (e.code === "EEXIST")
      refuse("A publication transaction directory already exists");
    throw e;
  }
  let journalInstalled = false;
  try {
    check();
    verifyOld();
    write(io, next, JSON.stringify(j, null, 2) + "\n");
    io.renameSync(next, journal);
    journalInstalled = true;
    durable(io, dir);
    durable(io, path.dirname(dir));
    for (const [i, item] of files.entries())
      write(io, item.tempPath, fileWrites[i].contents);
    check();
    verifyOld();
    for (const item of files)
      if (hash(io, item.tempPath) !== item.nextSha256)
        refuse("Staged output failed verification");
    for (const item of files) {
      if (item.kind === "replace") {
        io.renameSync(ledgerPath, backup);
        durable(io, dir);
        if (hash(io, backup) !== item.previousSha256) {
          // Restore the displaced writer's bytes without overwriting a competing creation.
          io.linkSync(backup, ledgerPath);
          refuse("Ledger changed during replacement");
        }
      }
      io.linkSync(item.tempPath, item.path);
      durable(io, path.dirname(item.path));
    }
    for (const item of files)
      if (hash(io, item.path) !== item.nextSha256)
        refuse("Post-write verification failed");
    checkApplied();
    j.status = "committed";
    write(io, next, JSON.stringify(j, null, 2) + "\n");
    io.renameSync(next, journal);
    durable(io, dir);
    recoverPublication({
      paths,
      fileSystem: io,
      contentDirectories,
      owner: internal,
    });
  } catch (error) {
    if (!journalInstalled) {
      if (io.readdirSync(dir).length === 0) io.rmdirSync(dir);
      throw error;
    }
    let state;
    try {
      state = JSON.parse(io.readFileSync(journal)).status;
      recoverPublication({
        paths,
        fileSystem: io,
        contentDirectories,
        owner: internal,
      });
    } catch (recovery) {
      // The synchronous publisher is leaving; allow explicit recovery in the same long-lived Studio process.
      if (exists(io, journal)) abandoned.add(journal + "\0" + id);
      throw Error(
        "Publication " +
          (state === "committed"
            ? "committed with cleanup incomplete"
            : "interrupted") +
          "; recovery required: " +
          recovery.message,
      );
    }
    if (state !== "committed")
      throw Error("Publication failed and was rolled back: " + error.message);
  }
  return {
    hashes: Object.fromEntries(files.map((f) => [f.path, f.nextSha256])),
  };
}
const abandoned = new Set();
module.exports = { applyTransaction, recoverPublication, recoveryLock };
