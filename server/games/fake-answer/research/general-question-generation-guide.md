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
unused.

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
unknown until separately assessed. The canonical content and review workflow
offers structured claim, source, provenance, and use-specific decisions, but
the current playable bank and its topic ledger do not link every legacy record
to canonical claims or formal review decisions. Do not duplicate that model in
this ledger or imply that the ledger supplies those decisions.

## 5. Identity, format, and incoming workflow

Keep stable question IDs and the existing JSON question format. IDs identify
records, not the fact itself; do not derive identity from array position, pack
filename, tags, category, or displayed wording. Do not change an ID to evade a
duplicate warning or reuse one for a different question.

For each incoming batch, use the established workflow from `incoming/README.md`:

1. Draft a JSON candidate in `incoming/`, outside runtime-loaded directories.
2. Run batch preview for the intended game and inspect blocking errors, source
   metadata warnings, and every within-bank, cross-bank, or batch duplicate
   match.
3. Generate and complete the offline editorial checklist for each stable ID.
   Inspect sources and evidence yourself; record factual support, wording and
   game-quality judgments, and rights assessment separately. Do not mark
   unknown rights as approved.
4. Resolve concerns in the incoming candidate, then rerun preview.
5. Import only after human review. Use explicit duplicate approval only when a
   reviewer has checked each match and recorded why it is distinct.
6. Run the individual validator and read-only question inventory after import.

The preview and checklist are review aids, not approval, publication, or
factual/legal determinations. Import remains a separate explicit action.

## 6. Maintain the topic ledger

Treat `general-topic-ledger.json` as a reconciliation-backed planning index.
It records exact legacy identities and pack membership alongside provisional
editorial topic, subtopic, question-type, and claim-summary classifications.
Its source fields describe only the attribution present in the JSON. The ledger
marks source support and factual verification as unassessed and rights as
unknown unless a separate evidence-based review record says otherwise.

Update the ledger only after a question has been accepted into a published
content pack. For each accepted addition:

1. copy the exact `gameId`, `contentPackId`, and `questionId` from the imported
record;
2. assign topic, subtopic, question type, and a concise underlying-claim
summary from the actual question, not merely its legacy category or tags;
3. compare the summary with existing entries and log likely overlaps or
   uncertain classifications for human review;
4. describe supplied source attribution faithfully without changing unchecked
   review statuses to verified or approved; and
5. reconcile every ledger identity against the published pack inventory and
   remove no ledger entry unless its corresponding published content was
   intentionally retired, documenting the reason.

Do not add incoming or rejected candidates as represented playable questions.
Record planning notes separately if they are useful, clearly marked as
unpublished. Keep this file under `research/`; it must never be moved into
`content/` or loaded by the question bank.

Run the read-only reconciliation and coverage report from `server/`:

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
