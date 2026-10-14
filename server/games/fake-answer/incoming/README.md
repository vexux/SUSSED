# Incoming Fact-or-Cap batches

Put generated candidate JSON batches in this directory before review. It is
shared by General Fact-or-Cap and Fact-or-Cap Anime; always pass the intended
target game ID. Runtime question banks read only sibling `content/` and
`content-anime/` directories, so files in `incoming/` are never playable packs.
Do not put canonical documents, migration manifests, review decisions, or Bruh
wtf? prompt packs here.

## Current batch format

A batch uses the existing playable question schema:

```json
{
  "contentPackId": "general-space-batch-2026-11-001",
  "questions": [
    {
      "id": "saturn-rings-ice-particles",
      "text": "Saturn's rings are made mostly of ____.",
      "correctCompletion": "ice particles",
      "sourceName": "NASA",
      "sourceUrl": "https://example.org/source"
    }
  ]
}
```

Each question requires a non-empty `id`, `text`, and `correctCompletion`.
`sourceName` and `sourceUrl` are optional in the general playable schema, but
the batch importer requires both and checks that the URL is HTTP(S). Attribution
and a valid URL do not establish that a source supports the claim or grants
reuse permission; those require separate human review.

Optional question fields are `category`, `tags` (an array of non-empty
strings), `difficulty` (`easy`, `medium`, `hard`, or `extremely-hard`), and
`contentPackId`. Prefer setting the question-level `contentPackId` to the
top-level value when including it; a mismatch is rejected. If omitted, the
runtime fills it from the top-level pack ID.

Choose a new top-level pack ID using lowercase letters, numbers, and hyphens,
starting with a letter or number, at most 64 characters. The imported filename
is exactly `<contentPackId>.json`; if that destination already exists, import
stops without overwriting it. Use unique, durable question IDs in lowercase
kebab case (letters/numbers separated by hyphens, at most 96 characters).
Prefer a concise subject-plus-fact slug such as
`saturn-rings-ice-particles`. Do not derive identity from array position,
display text, tags, or source filename. Never change an ID to disguise a
duplicate or reuse an ID for a different question. Question IDs must be unique
across both registered Fact-or-Cap banks.

## Preview and import

Run commands from `server/`. Examples assume these candidate files:
`games/fake-answer/incoming/general-batch-001.json` and
`games/fake-answer/incoming/anime-batch-001.json`.

Preview each batch against its selected bank:

```sh
npm run questions:preview -- --target fact-or-cap --input games/fake-answer/incoming/general-batch-001.json
npm run questions:preview -- --target fact-or-cap-anime --input games/fake-answer/incoming/anime-batch-001.json
```

Preview does not write to the candidate or either published content directory.
It reports the target, candidate question count, destination, blocking
validation/ID errors, warnings, duplicate matches, and eligibility. A matching
question ID is a blocking ID conflict. Content duplicates are separate review
warnings and show candidate ID, game ID, pack ID, question ID, and whether the
match is within the target bank, within the candidate batch, or across banks.

Prompt/answer matching applies Unicode NFKC normalization, lowercasing, and
punctuation/spacing normalization. It catches normalized pairs, not semantic
duplicates: paraphrases can be missed, and similar wording can express a
different claim. Inspect every match and review likely paraphrases manually.
Do not delete or rewrite a question automatically based on this signal.

### Editorial review packet

For batches of 25–50 questions, generate an offline, read-only Markdown checklist
after previewing the batch:

```sh
npm run report:question-editorial-checklist -- --target fact-or-cap --input games/fake-answer/incoming/general-batch-001.json
npm run report:question-editorial-checklist -- --target fact-or-cap-anime --input games/fake-answer/incoming/anime-batch-001.json
```

The report prints to stdout and retains each stable question ID, candidate
prompt/completion and metadata, supplied source attribution, and preview
warnings/matches. It provides separate blank fields for checking source passages
and evidence locators, factual support (including compound claims), clarity and
answerability, intended-game quality, rights/reuse review, intended-use
decision, reviewer/date, and disposition. Source names and URLs are shown as
candidate-provided metadata only. The packet makes no human decisions and does
not edit or approve its input; structural validity and an import-eligible
preview are not evidence of factual accuracy, source support, entertainment
quality, or permission to reuse content. Rights remain unknown until separately
assessed. It is an editorial aid, not the canonical migration review packet or
formal readiness report.

Automated checks distinguish blocking structure/ID/import errors, source
metadata warnings, and likely normalized duplicate matches. They do not perform
semantic duplicate detection, source-page inspection, factual verification,
editorial judgment, or rights assessment. Resolve each category with its own
checks; do not treat one category as a substitute for another.

After completing the checklist, resolving preview errors/warnings/matches, and
making any necessary edits to the incoming file, run preview again. Import a
batch with no likely duplicate matches:

```sh
npm run questions:import -- --target fact-or-cap --input games/fake-answer/incoming/general-batch-001.json
npm run questions:import -- --target fact-or-cap-anime --input games/fake-answer/incoming/anime-batch-001.json
```

If a human has reviewed the reported matches and explicitly decides the
candidate is distinct, add `--allow-likely-duplicates` to the corresponding
`questions:import` command. This is an explicit override for content-match
warnings only; it cannot override invalid questions, duplicate IDs, missing
source attribution, or an existing destination pack. Import validates again
and atomically creates a new file without overwriting. Keep the incoming source
file until the imported pack and report have been reviewed.

## Validation and inventory

The individual pack validator checks structure, fields, URL shape, difficulty,
unknown-field warnings, and ID conflicts. Batch preview is the definitive
pre-import check because it additionally requires attribution and compares
normalized content against the target bank, the other registered bank, and
within the candidate batch.

```sh
# Optional individual structural check
npm run validate:questions -- fact-or-cap games/fake-answer/incoming/general-batch-001.json
npm run validate:questions -- fact-or-cap-anime games/fake-answer/incoming/anime-batch-001.json

# After importing, validate the published pack at its destination
npm run validate:questions -- fact-or-cap games/fake-answer/content/<content-pack-id>.json
npm run validate:questions -- fact-or-cap-anime games/fake-answer/content-anime/<content-pack-id>.json

# Validate and inspect every published Fact-or-Cap pack, IDs, and duplicate signals
npm run report:question-inventory

# Focused tests for batch behavior, library validation, and the read-only report
node --test test/questionBatch.test.js test/questionLibrary.test.js test/questionInventory.test.js
npm test
```

The inventory command lists published pack filenames and IDs, question counts,
bank totals, structural validation errors, duplicate IDs, and normalized
duplicate-content counts. Check its per-pack counts and bank totals after
import. Missing source information and unknown fields are warnings in the base
schema; the importer blocks missing source attribution, while unknown-field
warnings remain visible for editorial cleanup. Duplicate-content counts are
heuristics, not proof of semantic equivalence.

The two playable banks are discovered from their explicit runtime directories;
this inventory covers both. Canonical content remains in `content-canonical/`
with separate validators and manifests. Bruh wtf? uses
`games/bruh-wtf/content/` and its own versioned schema and validator; this
workflow neither reads nor imports it.
