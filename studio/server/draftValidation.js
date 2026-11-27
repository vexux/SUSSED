const path = require("node:path");
const fact = require("../../server/games/fact-or-cap/questionLibrary");
const bruh = require("../../server/games/bruh-wtf/questionLibrary");
const {
  inspectBatch,
} = require("../../server/games/fact-or-cap/scripts/manage-question-batch");
const {
  makeAnimeLedgerUpdate,
} = require("../../server/games/fact-or-cap/animeLedgerPreview");
const {
  buildGeneralTopicLedgerUpdate,
} = require("../../server/games/fact-or-cap/generalTopicLedgerMaintenance");
const {
  safePath,
  read,
  incoming,
  directories,
  ledgers,
} = require("./inventory");
const fs = require("node:fs");

function structure(pack, target) {
  const result = (target === "bruh" ? bruh : fact).validateQuestionPack(
    pack,
    "Draft",
  );
  const errors = [...result.errors];
  if (!Array.isArray(pack?.questions) || !pack.questions.length)
    errors.push("A candidate needs at least one question.");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(pack?.contentPackId ?? ""))
    errors.push("Invalid candidate pack ID.");
  if (target !== "bruh" && Array.isArray(pack?.questions))
    for (const q of pack.questions) {
      if (typeof q?.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(q.id))
        errors.push(
          "Question IDs must be stable lowercase IDs of at most 96 characters.",
        );
      if (
        q?.contentPackId !== undefined &&
        q.contentPackId !== pack.contentPackId
      )
        errors.push("Question pack ID differs from candidate pack ID.");
    }
  return { errors, warnings: result.warnings ?? [] };
}

function validate(root, file, target, pack, metadata) {
  const { errors, warnings } = structure(pack, target);
  const metadataErrors = [],
    matches = [];
  const info = [
    "Text matches are mechanical comparisons. Source support, rights and semantic overlap require human review.",
  ];
  if (!target) errors.push("Choose the target game.");
  if (errors.length) return { errors, warnings, metadataErrors, matches, info };
  const byDir = new Map(),
    content = new Map();
  for (const id of target === "bruh" ? ["bruh"] : ["general", "anime"]) {
    const dir = safePath(root, directories[id]);
    const names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
    byDir.set(dir, names);
    for (const name of names)
      content.set(
        path.join(dir, name),
        read(root, path.join(directories[id], name)),
      );
  }
  const dir = safePath(root, directories[target]);
  const packs = byDir
    .get(dir)
    .map((fileName) => ({
      fileName,
      data: JSON.parse(content.get(path.join(dir, fileName))),
    }));
  if (target === "bruh") {
    const result = bruh.validateQuestionLibrary([
      ...packs,
      { fileName: file, data: pack },
    ]);
    errors.push(...result.errors);
    info.push(
      "Bruh WTF uses its own prompt, placeholder and taxonomy checks; no sidecar is required.",
    );
  } else {
    const input = path.join(root, incoming, file);
    content.set(input, Buffer.from(JSON.stringify(pack)));
    const memory = {
      readFileSync: (name, encoding) =>
        encoding ? content.get(name).toString(encoding) : content.get(name),
      existsSync: (name) => content.has(name) || byDir.has(name),
      readdirSync: (name) => byDir.get(name),
    };
    const targets = Object.fromEntries(
      ["general", "anime"].map((id) => [id, safePath(root, directories[id])]),
    );
    const inspected = inspectBatch({
      target,
      inputPath: input,
      contentDirectories: targets,
      fileSystem: memory,
    });
    errors.push(...inspected.errors);
    warnings.push(...inspected.warnings);
    const lookup = new Map();
    for (const [name, bytes] of content) {
      if (name === input) continue;
      const p = JSON.parse(bytes);
      const packId = p.contentPackId ?? path.basename(name, ".json");
      for (const q of (Array.isArray(p) ? p : p.questions) ?? [])
        lookup.set(JSON.stringify([path.dirname(name), packId, q.id]), q);
    }
    for (const m of inspected.duplicateMatches) {
      const candidate = pack.questions.find((q) => q.id === m.candidateId);
      const existing =
        m.matchSource === "candidate-batch"
          ? pack.questions.find((q) => q.id === m.existingQuestionId)
          : lookup.get(
              JSON.stringify([
                targets[m.gameId],
                m.contentPackId,
                m.existingQuestionId,
              ]),
            );
      matches.push({
        ...m,
        kind:
          existing?.text === candidate.text &&
          existing.correctCompletion === candidate.correctCompletion
            ? "exact"
            : "normalized",
      });
      if (m.matchSource === "candidate-batch")
        errors.push(
          "Repeated prompt and completion within candidate: " + m.candidateId,
        );
    }
    const ledger = JSON.parse(read(root, ledgers[target]));
    if (!metadata)
      metadataErrors.push(
        "Missing " +
          (target === "anime"
            ? "franchise assignments"
            : "topic classifications") +
          ".",
      );
    else {
      try {
        if (target === "anime")
          metadataErrors.push(
            ...makeAnimeLedgerUpdate(
              ledger,
              metadata,
              pack,
              packs.map((p) => ({ ...p.data, fileName: p.fileName })),
            ).errors,
          );
        else {
          const filename = pack.contentPackId + ".json";
          if (byDir.get(dir).includes(filename))
            metadataErrors.push("Destination pack ID already exists.");
          else {
            byDir.set(dir, [...byDir.get(dir), filename]);
            content.set(
              path.join(dir, filename),
              Buffer.from(JSON.stringify(pack)),
            );
            metadataErrors.push(
              ...buildGeneralTopicLedgerUpdate({
                ledger,
                manifest: metadata,
                contentDirectory: dir,
                fileSystem: memory,
              }).errors,
            );
          }
        }
      } catch (error) {
        metadataErrors.push("Invalid metadata: " + error.message);
      }
    }
  }
  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    metadataErrors,
    matches,
    info,
  };
}
module.exports = { structure, validate };
