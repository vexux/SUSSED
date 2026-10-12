# Bruh wtf? content creation and review guide

This is an editorial guide, not a generator specification. Research files stay
outside `content/`; only validated playable JSON packs belong there. Do not
generate or import production content without a separate editorial review.

## Editorial direction

- Mix humour, with chaos as the dominant direction. Prefer surreal,
  unexpected premises that make a player want to invent an answer.
- Frequently target named players, mostly one at a time, with occasional pairs
  and groups. Vary prompt formats and lengths.
- Use natural internet slang and current trends where they fit, balanced with
  evergreen prompts. Mark genuinely trend-dependent material with the
  `trend-dependent` tag and record a trend reference in the history.
- Approved subject areas include flirting, attraction, rejection, personal
  preferences, creative inventions, group conflict, adult humour, fictional
  scenarios, work, money, technology, mystery and competition. Use the
  canonical category IDs in `category-template-ledger.json`.
- Adult material must be clearly identified with `adult-content` and must
  genuinely be opt-in. The current room/game architecture has no adult-content
  preference or default-exclusion mechanism; this is a product capability gap,
  not something the tag enforces.
- Personal questions must not require truthful disclosure of sensitive
  information. Edgy personal humour and harsh roasts are permitted, but do not
  create derogatory attacks targeting protected traits.

## Acceptance and rejection

Every accepted question should be original, immediately clear when player
names are substituted, answerable as an open-ended party prompt, and have strong
comedic potential. Reject generic prompts and superficial rewordings of an
existing premise. Check both accepted and rejected history: rejection reasons
distinguish an exact duplicate, generic idea, weak premise, unclear prompt and
expired trend so the same weak item is not repeatedly proposed. A rejection is
about that candidate; it does not ban its whole category.

Structural validation is not editorial approval. It checks format, identity,
placeholders, metadata, duplicates and text integrity; a human still decides
whether the premise is original, clear, appropriate, funny, and suitable for
the intended audience.

## Pack contract

Format version remains 1. Pack IDs and question IDs are stable lowercase
kebab-case. New pack filenames should match their pack ID; the existing
development fixture keeps its original filename for compatibility. Every prompt uses each named
placeholder from `{{player1}}` to `{{playerN}}` exactly once and has
`requiredPlayers: N`. N is 1–8; this limit applies to named placeholders in a
prompt, not room size. Categories use canonical IDs. Tags are separate,
controlled descriptors for tone, targeting and content lifecycle. See the
Bruh wtf? README for the exact supported values and the offline validator.

## Duplicate review

The validator blocks repeated question IDs and exactly normalized prompt
duplicates. Normalization applies Unicode NFKC, lowercases and collapses
whitespace. It cannot reliably detect semantic duplicates; a different
wording or structure may encode the same joke, and a repeated broad setup may
still support a genuinely different idea. Do not treat a fingerprint as proof
of originality.

For every candidate batch, compare each premise with accepted questions,
rejected questions, recent batches and overrepresented template families.
Review the underlying comedic premise, target pattern, expected answer space,
and whether the new version merely swaps nouns or synonyms. Record possible
semantic overlap as an editorial warning in the batch audit, with a human
disposition. Exact normalized duplicate detection remains blocking.

## Repeatable batch workflow

1. Give every candidate a stable ID, canonical category, template-family ID,
   premise fingerprint and `proposed` history record.
2. Validate one pack with `npm run validate:bruh-wtf -- <pack.json>`; run
   `npm run validate:bruh-wtf -- --all` after placement in `content/`.
3. Review each candidate and compare against the entire accepted and rejected
   history. Record accepted, rejected or retired status and a reason/date.
4. Write a batch audit using `batch-audits/TEMPLATE.md`. Record validation,
   category/family coverage, exact and editorial duplicate findings, text
   integrity, decisions and trend review.
5. Only place reviewed, intended-for-release content in a `production` pack.
   A structurally valid production pack is not automatically approved for
   audience suitability or adult-content release.

The validator is offline and read-only. It never repairs text or changes a
pack. Text-integrity patterns detect known damage signatures but cannot
identify every encoding problem; inspect ambiguous findings manually.

## Editorial history records

`question-history.json` uses `formatVersion: 1` and stores one entry per
candidate with `questionId`, `status` (`proposed`, `accepted`, `rejected`, or
`retired`), `categoryId`, `templateFamilyId`, `premiseFingerprint`,
`reviewDate`, `trendReferences` and `editorialNotes`. Add `packId` only when
accepted. Rejected or retired entries must include a specific
`decisionReason`; proposed entries may use a null `reviewDate` until reviewed.
Keep the record when a candidate is rejected so the reason informs later
reviews. A rejected candidate does not prohibit other prompts in its category.

The category/template ledger lists all canonical categories and reusable
families. Each family has a stable ID, premise description and fingerprint,
status, accepted/rejected question IDs, and overlap notes. Update accepted and
rejected IDs only after a human decision; fingerprints aid comparisons but do
not make those decisions.
