# Anime Question-Bank Generation Guide

This guide defines the editorial rules for future anime question batches. The
playable question schema and validation workflow remain defined by the existing
question-library tools. The franchise ledger at
`research/anime-franchise-ledger.json` is the authoritative inventory of
franchises represented by accepted playable content.

## 1. Prioritize franchise coverage

- The current priority is to introduce as many distinct anime franchises as
  reasonably possible before substantially increasing questions per franchise.
- Franchise coverage guides selection but never justifies accepting weak or
  routine trivia.
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
Vary the underlying fact patterns and the player experience, not just franchise
names or question-type labels.
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

Question-type labels describe possible subject matter, not automatic approval:
apply the gameplay and evidence standards below to every item.

## 3. Gameplay-first question design

Anime Fact-or-Cap is a bluffing party game, not a conventional anime quiz. Aim
for **balanced surprise**: most accepted answers should be unexpected and
entertaining, with a smaller number of genuinely bizarre answers. Questions
must work for mixed groups of anime fans and non-fans. The desired reaction is:
“That sounds made up, but it could be true.” The fact itself need not always be
bizarre; the prompt and answer together should invite convincing lies while
making the true completion difficult to predict.

Evaluate every candidate for:

1. **Bluffability:** Could someone who has never watched the anime invent a
   plausible fake completion from the prompt?
2. **Surprise:** Is the answer less predictable than basic character
   information or an introductory plot detail?
3. **Fan resistance:** Would a reasonably knowledgeable fan need a moment to
   recall or believe the answer?
4. **Clear answer:** Does reliable evidence establish one intended completion?
5. **Reveal payoff:** Is the answer strange, funny, counterintuitive, or
   memorable enough to provoke a reaction?

Normally exclude or rewrite routine recall questions about basic names,
surnames, aliases, identities, obvious terminology, straightforward
occupations, species, powers, relationships, school grades, character goals,
or generic introductory premises. Also reject prompts that give away the
completion, trivia that is obscure but uninteresting, and questions whose
difficulty comes from missing context or an unfamiliar proper noun rather than
a satisfying bluff. A question's subject category does not excuse routine
recall: an ability, relationship, or production credit is suitable only when
the fact has real gameplay value.

For example, these are poor party-game prompts because they test simple recall:

- “The ancient board game at the center of Hikaru no Go is ____.”
- “Asta is unusual because he has no ____.”
- “Sakura is a fourth-grade ____.”

Relabeling a basic recall question as medium or hard does not improve it.
Prefer strange fictional rules, unexpected consequences, peculiar objects,
bizarre rituals, counterintuitive worldbuilding, unusual limitations,
surprising canon incidents, and memorable details that support plausible
alternative answers.

### Calibrate difficulty for gameplay

Difficulty describes the gameplay experience, not simply how obscure the anime
or fact is:

- **Easy:** Approachable to a mixed group, with enough context to guess
  plausibly, while the true answer still has a small surprise.
- **Medium:** Meaningfully unexpected, with several fake completions that could
  sound convincing even to fans. Aim for most of the batch to land here.
- **Hard:** Especially counterintuitive, bizarre, or difficult to predict,
  while non-fans still have enough context to bluff.
- **Extremely hard:** Use sparingly for an exceptionally unpredictable or
  bizarre answer with a strong reveal payoff. It still needs clear context and
  one well-supported completion; obscurity alone is not enough.

Include a meaningful selection of easy questions whose answers are still
surprising, mostly medium questions, and a smaller set of genuinely
challenging questions. Reassess the distribution after drafting rather than
forcing questions into quotas. Do not make a question hard by making it vague
or removing context.

## 4. Plan before drafting

Before generating a batch:

1. Read this guide, the franchise ledger, and every playable JSON pack under
   `content/anime/`.
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

## 5. Quality and evidence

- Every prompt must have one clear, defensible completion and enough context to
  stand alone in a mixed-anime game.
- Prefer gameplay value and a satisfying reveal over routine recall or trivia
  that is merely obscure. Avoid ambiguity, subjective claims, fan theories
  presented as canon, and unsupported superlatives.
- State whether a claim concerns the anime, manga, film, sequel, remake, or
  spin-off when that distinction matters.
- Prefer reliable primary evidence: official franchise sites, publisher and
  broadcaster pages, creator interviews, production documentation, and official
  reference material.
- Check that the cited passage directly supports the actual wording and answer;
  a relevant franchise URL or source title is not enough.
- Assess claim accuracy, source support, gameplay quality, and reuse rights as
  separate questions; inspecting a source does not by itself establish all four.
- If evidence is inaccessible or insufficient, locate better evidence or
  exclude the claim. Never fabricate citations or call unchecked content
  verified.
- Track source-check status during research. Valid JSON and a passing structural
  validator do not establish factual accuracy.
- Source attribution does not establish copyright, licensing, or permission to
  reuse content. Assess those rights separately.

## 6. Preserve the playable format and verify the batch

Preserve the existing JSON schema, stable IDs, attribution fields, supported
difficulty values (`easy`, `medium`, `hard`, and `extremely-hard`), and
question-pack workflow. Apply the gameplay calibration above without changing
the schema. Include accessible questions alongside harder ones.

From the `server/` directory, validate a candidate pack with:

```sh
npm run validate:questions -- fact-or-cap-anime games/fact-or-cap/content/anime/<pack>.json
```

Preview a proposed batch against the anime bank before import:

```sh
npm run questions:preview -- --target fact-or-cap-anime --input path/to/batch.json
```

Treat duplicate warnings as review signals: exact normalized prompt-and-answer
matches do not detect every paraphrase, and structural validation does not
replace editorial review of evidence, quality, or rights. Update the ledger only
after accepted questions are in the playable packs, and keep both the guide and
ledger under `research/`, outside `content/anime/` so the loader cannot mistake
them for question packs.
