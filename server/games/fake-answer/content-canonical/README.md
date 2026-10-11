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
`sources`, and `transformations`. Each record has `recordVersion: 1`; a future
incompatible record shape can use a new record version, while incompatible
document-level changes use a new schema version. The current validator accepts
only version 1 for both.

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

## Status fields and validation boundary

Supported review statuses are `unreviewed`, `flagged`, `reviewed`, and
`rejected`. Claim verification statuses are `unverified`, `verified`, and
`disputed`. Rights review statuses are `unknown`, `permitted`, `restricted`,
`public-domain`, and `permission-required`. These are recorded assertions by a
future review process, not conclusions produced by the validator. A permitted
status should be accompanied by a specific license or documented basis; the
pilot keeps rights status explicitly unknown and license null.

`validateCanonicalContent()` checks required record structure, supported schema
and record versions, ID shape and uniqueness, status values, URL shape,
references, franchise relationship kind, and that transformation entities are
also connected through its linked claims. It does not determine whether a
claim is true, whether a source supports it, whether text is original, whether
a license permits reuse, or whether a transformation is suitable or balanced
for a game. Those need distinct editorial, factual, and rights review.

The current `questionLibrary.js` validator remains responsible for legacy
playable packs and their prompt/answer duplicate heuristic. The canonical
validator is separate and does not feed, convert, or modify those packs. A
future adapter can materialize game-specific playable records from approved
canonical claims and transformations after a migration design is reviewed.
