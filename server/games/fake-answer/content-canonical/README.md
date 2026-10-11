# Canonical content format (version 1)

This directory is a separate, opt-in foundation for reusable, source-backed
content. It is not loaded by the current Fact-or-Cap question banks. Existing
playable packs under `content/` and `content-anime/` keep their current format
and runtime behavior.

Validate a canonical file with:

```sh
cd server
npm run validate:canonical -- games/fake-answer/content-canonical/pilot.json
```

## Document and records

A document has `schemaVersion: 1` and four arrays: `entities`, `claims`,
`sources`, and `transformations`. Schema versioning is document-level: all four
record shapes evolve together. Independent record versions would duplicate
version metadata without a separate storage or migration contract, so they are
not used. The current validator accepts only document schema version 1 and
rejects a `recordVersion` field to avoid implying independent compatibility.

- **Entity:** a reusable subject with an ID, kind, display name, review status,
  and optionally a `franchiseEntityId` relationship. Supported kinds include
  franchise, series, character, game, person, location, organization, concept,
  and other. Franchise relationships must point to a franchise or series.
- **Claim:** an assertion with a stable ID and statement, one or more `entityIds`,
  one or more `sourceIds`, a verification status, and a review status.
- **Source:** source identity (title and URL), optional publisher and creator,
  `accessedAt`, review status, and a `rightsReview` record with status, license,
  review date, reviewer ID, and notes. Unknown access dates and licensing
  information are represented explicitly as `null` and
  `rightsReview.status: "unknown"`; URL availability never implies permission.
- **Transformation:** a stable ID, a `gameFormatId`, references to entities and
  claims, review status, and a format-specific `payload`. Multiple
  transformations can refer to the same canonical records without duplicating
  their underlying claim or entity.

Claims record evidence associations through `sourceIds`; many claims may reuse
the same source, and one claim may list multiple sources. A transformation links
to claims, and those claims link to their sources, so source attribution is
transitive (`transformation → claim → source`). Its `entityIds` records the
entities used by that transformation and must be present on at least one linked
claim. No source text, quotation, or evidence locator is copied into a
transformation. The validator checks that these references exist and are
consistent, not that a listed source actually supports a claim.

Every ID is globally unique across all four record arrays and follows the
kind-prefixed lowercase convention, for example `entity:sailor-moon`,
`claim:sailor-moon-talking-cat`, `source:toei-sailor-moon`, and
`transform:sailor-moon-flashcard`. IDs are durable references, not display
names, tags, paths, or array positions. Renames should preserve IDs; an entity
relationship or corrected source association should update references without
reusing an ID for a different record.

`pilot.json` is deliberately small and uses one claim already represented in
the existing anime pack. It shows two format payloads (a Fact-or-Cap completion
and a flashcard) linked to the same series, character, claim, and source. The
fixture is illustrative; these format IDs do not register or enable additional
games.

The relationship test adds a synthetic second source reference to exercise the
multi-source graph shape. It is explicitly unverified and does not claim that
the synthetic source supports the pilot fact.

## Status fields and validation boundary

Supported review statuses are `unreviewed`, `flagged`, `reviewed`, and
`rejected`. Claim verification statuses are `unverified`, `verified`, and
`disputed`. Rights review statuses are `unknown`, `permitted`, `restricted`,
`public-domain`, and `permission-required`. These are recorded assertions by a
future review process, not conclusions produced by the validator. A permitted
status should be accompanied by a specific license or documented basis, review
date, and reviewer ID. Every determined rights status requires reviewer/date
metadata; `unknown` requires a null license. The pilot keeps rights status
explicitly unknown and license null.

`validateCanonicalContent()` checks required record structure, supported schema
version, ID shape and uniqueness, status values, URL shape,
references, franchise relationship kind, and that transformation entities are
also connected through its linked claims. It does not determine whether a
claim is true, whether a source supports it, whether text is original, whether
a license permits reuse, or whether a transformation is suitable or balanced
for a game. Those need distinct editorial, factual, and rights review.

## Fact-or-Cap adapter

`factOrCapAdapter.js` is a standalone converter; live question banks do not call
it. It accepts a schema-valid document and one transformation ID or a list of
IDs whose `gameFormatId` is `fact-or-cap.completion.v1`. Each selected
transformation must reference exactly one claim and provide a non-empty
`payload.text`. Provide exactly one answer input: `payload.correctCompletion`
for a literal completion, or `payload.answerEntityId` to derive the completion
from the referenced entity's display name. Optional `category`, `tags`, and
`difficulty` values are copied from that transformation's payload. The caller
may pass `contentPackId` as adapter options because pack identity is a packaging
concern, not an entity or claim identity.

The adapter returns legacy-shaped `questions` plus a separate
`provenanceByQuestionId` map. The question ID is the transformation ID. Each
provenance entry retains transformation, claim, entity, and all source IDs. The
legacy question fields have room for one source name and URL: when a claim has
one source, it is used automatically; with multiple sources, the transformation
must choose one using `payload.sourceId`. Other source IDs remain in the
provenance map. The adapter validates the result against the current
`questionLibrary.js` playable-question rules. Do not send provenance maps to
clients or treat successful conversion as factual or rights approval.

Another game format can add its own transformation with a different
`gameFormatId` and payload while reusing the same entities, claims, and sources.
That does not require changing canonical records. A format-specific adapter
would define how that payload is validated and materialized; this adapter
intentionally handles only Fact-or-Cap completions.

The current `questionLibrary.js` validator remains responsible for legacy
playable packs and their prompt/answer duplicate heuristic. The canonical
validator is separate and does not feed, convert, or modify those packs. A
future adapter can materialize game-specific playable records from approved
canonical claims and transformations after a migration design is reviewed.

## Migration manifest (version 1)

`migration-pilot.json` demonstrates the standalone migration manifest. Each
entry has exactly one legacy source reference (`gameId`, the pack's top-level
`contentPackId`, and `questionId`) and one `transformationId`:

```json
{
  "schemaVersion": 1,
  "entries": [{
    "gameId": "fact-or-cap-anime",
    "contentPackId": "anime-foundations",
    "questionId": "anime-sailor-moon-luna",
    "transformationId": "transform:sailor-moon-bluff-completion"
  }]
}
```

Validate a manifest against the existing banks and one canonical document with:

```sh
cd server
npm run validate:migration -- games/fake-answer/content-canonical/migration-pilot.json games/fake-answer/content-canonical/pilot.json
```

The validator resolves each source reference within its stated game and
top-level pack ID, rejects ambiguous or duplicate mappings, and calls the
Fact-or-Cap adapter for each transformation. It reports field-by-field
differences from the original legacy question; it never edits either source.
Structural validity, exact legacy matching, claim verification/review, source
review, and rights-review statuses are reported separately. In particular,
`unknown` rights status is unresolved and is never treated as permission.
Successful validation is not a factual or legal approval.

Manifest entries use existing game IDs, lowercase pack/question IDs, and one
kind-prefixed canonical transformation ID. One legacy question may appear only
once in a manifest, and each transformation may map to only one legacy
question. The manifest is a migration-time traceability record; it does not
change question-bank loading or live gameplay. The validator currently maps
the two Fact-or-Cap IDs to their existing directories explicitly.
