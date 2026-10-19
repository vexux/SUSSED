# General Fact-or-Cap Question Generation Guide

This guide is an editorial planning aid for future General Fact-or-Cap
questions. The published JSON packs remain the runtime source of questions.
The companion `general-topic-ledger.json` is a provisional topic and claim index
reconciled against the published packs; it is not a content pack or approval
record.

## 1. Plan broad coverage

Use the ledger to identify subjects, subtopics, and underlying claims already
represented. Prioritize underrepresented areas when comparable evidence and
question quality are available. Do not force a weak item to fill a category or
meet a numerical quota. The taxonomy is a planning vocabulary, not a runtime
schema or a claim that each area should receive equal space.

Current broad topics and useful subtopics include:

- **Space and astronomy:** solar-system objects, planetary properties and
  motion, moons, astronomy history, and spaceflight.
- **Life sciences:** animal anatomy, physiology, behavior, senses, diet,
  reproduction, plants, and biological classification.
- **Earth and environment:** oceans, atmosphere, geology, tectonics,
  geophysics, climate, and natural processes.
- **Geography:** places, landforms, rivers, waterways, coordinates, borders,
  and geographic measurements.
- **History and civilizations:** ancient and modern societies, discoveries,
  technology history, exploration, and documented events.
- **Culture and society:** language, traditions, symbols, food, arts, sport,
  and institutions.
- **Technology and engineering:** how objects and structures work, inventions,
  design, and engineering records.
- **Mathematics and physical sciences:** materials, forces, measurement,
  chemistry, physics, and counterintuitive demonstrations.

These are broad, overlapping editorial labels. Choose the best fit for the
claim itself and use a specific subtopic. Add or revise a subtopic when it
improves planning; do not create a new label solely to make a used subject look
unused. Current expansion should balance strong life-science and space
questions with opportunities in culture and society, technology and
engineering, and physical sciences and mathematics. Treat this as a direction
for finding worthwhile candidates, not a quota; evidence and playable quality
take priority.

## 2. Vary fact and prompt types

Useful forms include identification, count or measurement, chronology,
location, classification, anatomy, behavior or adaptation, cause and mechanism,
comparison, and a surprising but well-supported exception. Vary both the
surface wording and the underlying fact. A different completion, number, or
subject within an otherwise repeated fact pattern does not automatically add
meaningful variety.

Before drafting, inspect the whole ledger and published bank for:

1. the same underlying claim stated in different words;
2. a closely related fact that would make a batch repetitive even if it is not
   a duplicate;
3. repeated use of one subject, source, prompt pattern, or answer type; and
4. opportunities to cover an underrepresented area with a strong, sourced
   question.

The inventory and batch preview catch duplicate IDs and exact normalized
prompt/completion pairs. They do not perform semantic or paraphrase detection.
Human comparison of the claim summaries and question wording remains necessary;
record suspected relationships in the ledger for follow-up rather than treating
an automated match count as exhaustive.

## 3. Write playable questions

- Each prompt must stand alone and provide enough context to identify the
  intended subject, time period, and meaning of the completion.
- Ask one clear, defensible claim with a completion that fits naturally.
- Avoid compound claims when one answer would leave part of the assertion
  unsupported. Split them only when the resulting questions are independently
  useful and not repetitive.
- Avoid ambiguity, trick wording, unstated exceptions, subjective judgments,
  misleading absolutes, and superlatives unless the source defines the scope
  and directly supports them.
- Prefer memorable, surprising information over facts that are difficult only
  because they are obscure or lack useful context.
- Match difficulty to the knowledge and reasoning the question actually
  requires. Include accessible entries and a range of difficulty; this is an
  editorial goal, not a per-batch quota or schema constraint.
- Review the prompt and completion together for grammar, capitalization, units,
  rounding, and acceptable answer specificity.

## 4. Review evidence and rights separately

Prefer credible primary sources where practical: official scientific or
government references, original research, institutional records, publisher or
museum material, and first-hand interviews or documentation. A source's topic,
title, publisher, or URL is not evidence that it supports the exact claim.
Inspect the relevant passage and record a page, section, table, timestamp, or
other locator. Check each part of a compound assertion independently. If the
evidence is inaccessible, weak, contradictory, or does not establish the
completion, find adequate evidence or exclude/revise the candidate.

Keep these questions distinct in editorial review:

- Is the claim accurate, and what evidence establishes it?
- Does the cited source directly support the wording and answer?
- Is the prompt clear, unambiguous, entertaining, and suitable for this game?
- Is the source attribution complete and appropriately described?
- Are the text and source material reusable for the intended use, and on what
  basis or conditions?

Source attribution, structural validity, and public accessibility do not prove
factual correctness, source support, or permission to reuse. Rights remain
unknown until separately assessed. The playable question format and topic
ledger are not formal factual-verification or rights-review records; do not
imply that a classification or successful validator supplies those decisions.

## 5. Identity, format, and incoming workflow

Keep stable question IDs and the existing JSON question format. IDs identify
records, not the fact itself; do not derive identity from array position, pack
filename, tags, category, or displayed wording. Do not change an ID to evade a
duplicate warning or reuse one for a different question.

For each incoming batch, use the read-only preview and explicit import commands
below:

1. Draft a JSON candidate in `incoming/`, outside runtime-loaded directories.
2. Run `npm run questions:preview` for the intended game. It checks structure,
   IDs, source metadata, and exact normalized prompt/completion matches without
   writing files or fetching source pages.
3. Inspect cited evidence and decide factual support, wording, answerability,
   game quality, and rights/reuse separately. Preview does not detect semantic
   duplicates, verify claims, or approve use. Do not mark unknown rights as
   approved.
4. Resolve concerns in the incoming candidate, then rerun preview.
5. Import only after human review. Use explicit duplicate approval only when a
   reviewer has checked each match and recorded why it is distinct.
6. Run the individual validator and read-only question inventory after import.

Structural eligibility is not factual, legal, or publication approval. Import
remains a separate explicit action.

## 6. Maintain the topic ledger

Treat `general-topic-ledger.json` as a reconciliation-backed planning index.
It records exact legacy identities and pack membership alongside provisional
editorial topic, subtopic, question-type, and claim-summary classifications.
Its source fields describe only the attribution present in the JSON. The ledger
marks source support and factual verification as unassessed and rights as
unknown unless a separate evidence-based review record says otherwise.

Update the ledger only after a question has been reviewed and explicitly
imported into a published content pack. The updater derives identity, legacy
metadata, and source attribution from the published question itself. Editors
must supply provisional topic, subtopic, question type, claim summary, and an
explicit repetition-review note for each newly published ID. These are
planning classifications, not factual or rights decisions. Existing
classifications and human-authored repetition notes are preserved; the tool
does not retire records or resolve suspected overlaps.

From `server/`, prepare a classification JSON file outside the runtime content
directories, for example `games/fact-or-cap/incoming/general-batch-001-ledger.json`:

```json
{
  "manifestVersion": 1,
  "classifications": [
    {
      "contentPackId": "general-space-batch-2026-11-001",
      "questionId": "saturn-rings-ice-particles",
      "topicId": "space-astronomy",
      "subtopicId": "solar-system-objects",
      "questionType": "identification",
      "underlyingClaimSummary": "Saturn's rings consist mostly of ice particles.",
      "repetitionReview": {
        "outcome": "no-known-overlap",
        "note": "Compared with the current ledger claim summaries and repetition notes."
      }
    }
  ]
}
```

The only supported repetition outcomes are `no-known-overlap` and `flagged`;
both require a human note. Optional `repetitionReviewClusters` and
`suspectedSemanticDuplicates` arrays can append human review notes using the
ledger's existing fields. They cannot overwrite an existing cluster ID or
duplicate an existing suspected question set. All referenced IDs must resolve
unambiguously in the published General bank. The manifest does not accept
copied category/source fields: the updater derives those values from packs.

The updater previews by default. It refuses missing/ambiguous IDs, invalid
taxonomy/type references, invalid packs, stale ledger references, changes not
explained by new published questions, and invalid resulting reconciliation.
`--apply` performs an atomic deterministic replacement of the ledger file
only. Repeating an applied update produces no changes. Snapshot branch,
commit, date, and validation-basis provenance are preserved because the tool
cannot independently establish a new provenance context. It recalculates only
published-bank inventory/count and editorial-distribution fields.

If someone imports a pack but forgets the ledger update, do not import it
again: the import is already published and destinations are no-overwrite.
Prepare classifications for the missing stable IDs, run the preview, resolve
all errors and human overlap questions, then apply. If the updater reports
stale records, a removed pack, or broader count drift, investigate that change
instead of using maintenance to erase or conceal it.

Before each batch, consult current topic coverage and repetition notes to choose
candidate areas and fact patterns. Prefer variety in topic, source, claim type,
and prompt structure, and do not extend a dense subject cluster without an
editorial reason. The complete workflow from `server/` is:

```sh
# 1. Preview a candidate (read-only).
npm run questions:preview -- --target fact-or-cap --input games/fact-or-cap/incoming/general-batch-001.json

# 2. Import only after evidence, editorial, and rights review.
npm run questions:import -- --target fact-or-cap --input games/fact-or-cap/incoming/general-batch-001.json

# 3. Validate the published pack.
npm run validate:questions -- fact-or-cap games/fact-or-cap/content/general/<content-pack-id>.json

# 4. Prepare the classification manifest described above; preview, inspect, then explicitly apply.
npm run update:general-topic-ledger -- --classifications games/fact-or-cap/incoming/general-batch-001-ledger.json
npm run update:general-topic-ledger -- --classifications games/fact-or-cap/incoming/general-batch-001-ledger.json --apply

# 5. Reconcile coverage and inspect the inventory across both banks.
npm run report:general-content-coverage
npm run report:question-inventory

# 6. Run focused and full tests, inspect the diff, then commit approved files.
node --test test/generalTopicLedgerMaintenance.test.js test/generalTopicLedgerReport.test.js test/questionInventory.test.js test/questionBatch.test.js test/questionLibrary.test.js
npm test
git diff --check
```

If a normalized duplicate requires explicit human approval, use the import
override only after documenting the editorial decision. The ledger updater
cannot establish factual accuracy, direct source support, reuse rights, or
publication approval.

The standalone read-only reconciliation and coverage report can also be run from `server/`:

```sh
npm run report:general-content-coverage
npm run report:general-content-coverage -- --low-topic-threshold 8
```

The default low-coverage threshold is fewer than five questions per topic or
subtopic; `--low-topic-threshold` changes both. A non-zero exit indicates
structural ledger errors or disagreement with published pack membership and
copied fields. Editorial uncertainty and possible semantic repetition remain
separate review notes. The report checks topic, subtopic, question-type, and
repetition-note references. Its structural reconciliation errors mean the
ledger does not match stable published identities, membership, or copied
metadata; they do not make an editorial classification factually false. The
inventory's normalized prompt/completion matches are automated exact-format
signals, while repetition clusters and suspected semantic overlaps in the
ledger are human review notes with their stated uncertainty. Neither category
is exhaustive semantic duplicate detection. Topic classifications are
provisional editorial assignments. This report does not verify facts, inspect
source pages, assess source support or rights, or replace inventory and
editorial review. It never repairs or rewrites the ledger.
