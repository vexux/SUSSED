# Anime Question-Bank Generation Guide

This guide defines the editorial rules for future anime question batches. The
playable question schema and validation workflow remain defined by the existing
question-library tools. The franchise ledger at
`research/anime-franchise-ledger.json` is the authoritative inventory of
franchises represented by accepted playable content.

## 1. Prioritize franchise coverage

- The current priority is to introduce as many distinct anime franchises as
  reasonably possible before substantially increasing questions per franchise.
- Prefer franchises absent from the ledger. A proposed franchise must be
  compared with its `franchiseId`, display name, and recorded aliases; a new
  shorthand tag does not make a used franchise new.
- Reuse is permitted when a question contributes meaningfully different and
  valuable information. Changing only the wording, character, credited staff
  member, or answer is not sufficient justification by itself.
- The current three-questions-per-franchise batch guideline is a temporary
  diversity measure, not a permanent content-schema or gameplay limit. The
  owner may gradually raise it after broad franchise coverage is established.
- Add ledger records and aliases only after questions have been accepted into
  playable content. The ledger must reconcile with actual pack membership.

## 2. Vary question types

Plan a batch to avoid repeatedly using the same trivia format. Choose types that
can be supported by good evidence; do not force every type into every batch.
Possible types include:

- Bizarre, surprising, or counterintuitive facts.
- Character quirks, habits, unusual abilities, and lesser-known details.
- Plot or canon details beyond an ordinary synopsis.
- Worldbuilding, fictional rules, terminology, and organizations.
- Unusual objects, creatures, locations, and in-universe concepts.
- Creator intentions and documented inspirations.
- Production history and documented behind-the-scenes oddities.
- Adaptation differences among manga, anime, films, sequels, remakes, and
  spin-offs.
- Historical, cultural, or scientific references incorporated into a work.
- Specific unusual episode events or canon incidents.
- Strange names, translations, wordplay, terminology, records, and milestones.

Production-credit questions about staff, directors, composers, studios, or other
credits are valid but must not dominate the bank. For a large batch, aim as a
starting editorial target for at least six distinct question types and for
production-credit questions to be a minority. These are planning targets, not
schema constraints; prefer strong questions over forced numerical quotas.

## 3. Plan before drafting

Before generating a batch:

1. Read this guide, the franchise ledger, and every playable JSON pack under
   `content-anime/`.
2. Build a working index of franchise IDs and aliases, question IDs, prompts,
   completions, and recurring formats.
3. Note overrepresented franchise groups and question types, especially in
   recent batches.
4. Plan around unused franchises and underrepresented question types. Reuse a
   franchise only for meaningfully different information.
5. Compare proposed items with the whole bank for exact duplicates,
   near-duplicates, and repeated underlying facts. Do not rely only on changed
   wording or a different answer fragment to distinguish a question.

Write a brief batch plan before drafting the full set. Track franchise and
question-type distributions, then review the completed batch and revise it if
one format dominates. Do not add weak questions merely to reach a target count.

## 4. Quality and evidence

- Every prompt must have one clear, defensible completion and enough context to
  stand alone in a mixed-anime game.
- Prefer surprising, enjoyable facts over trivia that is merely obscure. Avoid
  ambiguity, subjective claims, fan theories presented as canon, and
  unsupported superlatives.
- State whether a claim concerns the anime, manga, film, sequel, remake, or
  spin-off when that distinction matters.
- Prefer reliable primary evidence: official franchise sites, publisher and
  broadcaster pages, creator interviews, production documentation, and official
  reference material.
- Check that the cited passage directly supports the actual wording and answer;
  a relevant franchise URL or source title is not enough.
- If evidence is inaccessible or insufficient, locate better evidence or
  exclude the claim. Never fabricate citations or call unchecked content
  verified.
- Track source-check status during research. Valid JSON and a passing structural
  validator do not establish factual accuracy.
- Source attribution does not establish copyright, licensing, or permission to
  reuse content. Assess those rights separately.

## 5. Preserve the playable format and verify the batch

Preserve the existing JSON schema, stable IDs, attribution fields, supported
difficulty values, and question-pack workflow. Difficulty should reflect the
fact's specialization or surprise, not missing context, vague wording, or a
misleading prompt. Include accessible questions alongside harder ones.

From the `server/` directory, validate a candidate pack with:

```sh
npm run validate:questions -- fact-or-cap-anime games/fake-answer/content-anime/<pack>.json
```

Preview a proposed batch against the anime bank before import:

```sh
npm run questions:preview -- --target fact-or-cap-anime --input path/to/batch.json
```

Treat duplicate warnings as review signals: exact normalized prompt-and-answer
matches do not detect every paraphrase, and structural validation does not
replace editorial review of evidence, quality, or rights. Update the ledger only
after accepted questions are in the playable packs, and keep both the guide and
ledger under `research/`, outside `content-anime/` so the loader cannot mistake
them for question packs.
