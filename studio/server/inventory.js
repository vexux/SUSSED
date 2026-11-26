const fs = require("node:fs");
const path = require("node:path");
const fact = require("../../server/games/fact-or-cap/questionLibrary");
const bruh = require("../../server/games/bruh-wtf/questionLibrary");
const {
  buildQuestionInventory,
} = require("../../server/games/fact-or-cap/questionInventory");
const {
  compareGeneralTopicLedger,
} = require("../../server/games/fact-or-cap/generalTopicLedgerReport");
const { decodeUtf8 } = require("../../server/content/textIntegrity");

const F = "server/games/fact-or-cap";
const directories = {
  anime: F + "/content/anime",
  general: F + "/content/general",
  bruh: "server/games/bruh-wtf/content",
};
const incoming = F + "/incoming";
const ledgers = {
  anime: F + "/research/anime-franchise-ledger.json",
  general: F + "/research/general-topic-ledger.json",
};

function safePath(root, relative) {
  const normalized = relative.split(path.sep).join("/");
  const allowed = [...Object.values(directories), incoming].some(
    (dir) =>
      normalized === dir ||
      (normalized.startsWith(dir + "/") &&
        /^[^/:\\]+\.json$/i.test(normalized.slice(dir.length + 1))),
  );
  if (!allowed && !Object.values(ledgers).includes(normalized))
    throw new Error("Path outside the content allowlist");
  const target = path.resolve(root, relative);
  if (
    !target.startsWith(root + path.sep) ||
    fs.realpathSync.native(target) !== target
  )
    throw new Error("Linked or external path refused");
  return target;
}
function read(root, relative) {
  const file = safePath(root, relative);
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.size > 16n * 1024n * 1024n)
    throw new Error("Expected a regular file under 16 MiB");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = () => fs.fstatSync(fd, { bigint: true });
    // Windows path stats can report device zero while descriptor stats report the volume ID.
    const changed = (s) =>
      s.ino !== before.ino ||
      (before.dev !== 0n && s.dev !== before.dev) ||
      s.ctimeNs !== before.ctimeNs ||
      s.size !== before.size;
    if (changed(stat()) || safePath(root, relative) !== file)
      throw new Error("File changed; rescan");
    const bytes = fs.readFileSync(fd);
    if (
      changed(stat()) ||
      changed(fs.lstatSync(safePath(root, relative), { bigint: true }))
    )
      throw new Error("File changed; rescan");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
function names(root, directory, optional = false) {
  try {
    return fs.readdirSync(safePath(root, directory)).sort();
  } catch (error) {
    if (optional && error.code === "ENOENT") return [];
    throw error;
  }
}
function buckets(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function scan(repository) {
  const root = fs.realpathSync.native(repository);
  const games = {};
  const bytes = new Map();
  const files = new Map();
  for (const [id, directory] of Object.entries(directories)) {
    const packs = [],
      rows = [],
      errors = [],
      warnings = [],
      inputs = [];
    const game = (games[id] = {
      id,
      packs,
      rows,
      errors,
      warnings,
      charts: {},
      partial: false,
    });
    const filenames = names(root, directory).filter((n) => n.endsWith(".json"));
    files.set(directory, filenames);
    for (const filename of filenames) {
      const p = { filename, id: null, count: null, errors: [], warnings: [] };
      packs.push(p);
      try {
        const buffer = read(root, path.join(directory, filename));
        bytes.set(path.join(directory, filename), buffer);
        const data = JSON.parse(decodeUtf8(buffer, filename));
        const result = (id === "bruh" ? bruh : fact).validateQuestionPack(
          data,
          filename,
        );
        const questions = Array.isArray(data) ? data : data?.questions;
        Object.assign(p, {
          id: data?.contentPackId ?? null,
          type: data?.packType,
          count: Array.isArray(questions) ? questions.length : null,
          errors: result.errors,
          warnings: result.warnings ?? [],
        });
        if (p.count === null) game.partial = true;
        inputs.push({ fileName: filename, data });
        if (Array.isArray(questions))
          for (const record of questions) rows.push({ pack: filename, record });
      } catch (error) {
        p.errors.push(error.message);
        errors.push(filename + ": " + error.message);
        game.partial = true;
      }
    }
    if (id === "bruh")
      errors.push(...bruh.validateQuestionLibrary(inputs).errors);
    if (!packs.length) errors.push("No published packs found");
  }
  // Give the existing reports only the bytes already inspected in this scan.
  const snapshotFS = {
    readdirSync(dir) {
      return files.get(dir);
    },
    readFileSync(file) {
      const value = bytes.get(path.normalize(file));
      if (!value) throw new Error("Unreadable pack");
      return value;
    },
  };
  const inventory = buildQuestionInventory({
    contentDirectories: {
      general: directories.general,
      anime: directories.anime,
    },
    fileSystem: snapshotFS,
  });
  for (const bank of inventory.banks) {
    games[bank.gameId].errors.push(...bank.validationErrors);
    games[bank.gameId].warnings.push(...bank.warnings);
  }
  for (const match of inventory.crossBankDuplicateIds) {
    for (const id of ["general", "anime"])
      games[id].errors.push("Cross-bank duplicate ID: " + match.questionId);
  }
  for (const [id, game] of Object.entries(games)) {
    const chart = (label, key) =>
      (game.charts[label] = buckets(
        game.rows.map((r) => String(r.record?.[key] ?? "Unspecified")),
      ));
    chart("Categories", "category");
    if (id === "bruh") chart("Required players", "requiredPlayers");
    else chart("Difficulty", "difficulty");
    game.charts["Questions per pack"] = game.packs
      .filter((p) => p.count !== null)
      .map((p) => [p.filename, p.count]);
    try {
      if (id === "general") {
        const ledger = JSON.parse(decodeUtf8(read(root, ledgers.general)));
        const report = compareGeneralTopicLedger({
          ledger,
          contentDirectory: directories.general,
          fileSystem: snapshotFS,
        });
        game.errors.push(...report.reconciliation.errors);
        if (report.reconciliation.valid) {
          game.charts.Topics = report.coverage.topicCounts.map((t) => [
            t.label,
            t.count,
          ]);
          game.coverage = report.coverage;
        }
      }
      if (id === "anime") {
        const ledger = JSON.parse(decodeUtf8(read(root, ledgers.anime)));
        const membership = new Map();
        for (const f of ledger.franchises)
          for (const p of f.packMemberships)
            for (const q of p.questionIds) {
              const key = JSON.stringify([p.contentPackId, q]);
              if (membership.has(key))
                throw new Error("Ambiguous franchise membership");
              membership.set(key, f.displayName);
            }
        const packIds = new Map(game.packs.map((p) => [p.filename, p.id]));
        for (const row of game.rows)
          row.franchise =
            membership.get(
              JSON.stringify([packIds.get(row.pack), row.record?.id]),
            ) ?? null;
        const mapped = game.rows.filter((r) => r.franchise);
        game.charts.Franchises = buckets(mapped.map((r) => r.franchise));
        game.coverage = {
          mapped: mapped.length,
          records: ledger.franchises.length,
        };
        if (
          mapped.length !== game.rows.length ||
          membership.size !== mapped.length
        )
          game.errors.push(
            "Franchise membership differs from published inventory",
          );
      }
    } catch (error) {
      game.errors.push("Coverage unavailable: " + error.message);
    }
  }
  const batches = scanInbox(root, games);
  return { games, batches, refreshed: new Date().toISOString() };
}

function scanInbox(root, games) {
  const batches = [];
  for (const filename of names(root, incoming, true)) {
    const batch = {
      filename,
      kind: "Unrecognised",
      json: null,
      target: null,
      sidecars: [],
    };
    batches.push(batch);
    if (!filename.toLowerCase().endsWith(".json")) continue;
    let data;
    try {
      const raw = read(root, path.join(incoming, filename));
      try {
        data = JSON.parse(decodeUtf8(raw, filename));
      } catch (error) {
        batch.json = false;
        throw error;
      }
      batch.json = true;
    } catch (error) {
      batch.kind = batch.json === false ? "Malformed" : "Unreadable";
      batch.error = error.message;
      continue;
    }
    batch.data = data;
    if (data?.manifestVersion === 1 && Array.isArray(data.classifications))
      batch.kind = "Classifications";
    else if (
      data?.manifestVersion === 1 &&
      Array.isArray(data.entries) &&
      data.entries.every((e) => typeof e?.franchiseId === "string")
    )
      batch.kind = "Franchise manifest";
    else if (
      typeof data?.contentPackId === "string" &&
      Array.isArray(data.questions)
    ) {
      batch.kind = "Candidate";
      const isBruh = Object.hasOwn(data, "packType");
      if (isBruh) batch.target = "bruh";
      const check = (isBruh ? bruh : fact).validateQuestionPack(data, filename);
      batch.errors = check.errors;
      batch.warnings = check.warnings ?? [];
      const key = (q) =>
        isBruh ? bruh.normalizePrompt(q.prompt) : fact.duplicateKey(q);
      const valid = (q) =>
        isBruh
          ? typeof q?.prompt === "string"
          : typeof q?.text === "string" &&
            typeof q.correctCompletion === "string";
      const published = (
        isBruh ? games.bruh.rows : [...games.anime.rows, ...games.general.rows]
      )
        .map((r) => r.record)
        .filter(valid);
      const ids = new Set(published.map((q) => q.id)),
        texts = new Set(published.map(key));
      batch.duplicates = {
        matchingPublishedIds: data.questions.filter((q) => ids.has(q?.id))
          .length,
        matchingPublishedText: data.questions.filter(
          (q) => valid(q) && texts.has(key(q)),
        ).length,
      };
    }
  }
  for (const batch of batches.filter(
    (b) => b.kind === "Candidate" && !b.target,
  )) {
    const id = batch.data.contentPackId;
    const matches = batches.filter(
      (b) =>
        (b.kind === "Franchise manifest" &&
          b.filename === id + "-franchises.json") ||
        (b.kind === "Classifications" &&
          b.data.classifications.length &&
          b.data.classifications.every((c) => c?.contentPackId === id)),
    );
    batch.sidecars = matches.map((b) => b.filename);
    const targets = new Set(
      matches.map((b) => (b.kind === "Classifications" ? "general" : "anime")),
    );
    if (targets.size === 1) batch.target = [...targets][0];
  }
  return batches;
}
module.exports = { scan, safePath };
