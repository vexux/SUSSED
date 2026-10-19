# Fact-or-Cap Content Publication Workflow

Use this offline workflow for General and Anime candidate packs. Published JSON
packs remain the runtime source of playable questions. The General topic ledger
and Anime franchise ledger remain separate supporting research records; neither
is evidence of factual accuracy or rights clearance.

Run commands from `server/`. All commands are read-only except `publish` and
`cleanup`. A review never edits its input, a pack, or a ledger.

## 1. Discover and review a batch

List JSON files in the incoming directory. Invalid JSON and files without a
pack shape are listed as such instead of silently being assigned to a game:

```powershell
npm run questions:publication -- list
```

The incoming directory is shared and candidate packs do not declare a game
target, so the listing labels each candidate `unassigned`. Choose the target
from its schema and review it explicitly; the command will not guess.

Review one candidate against only its own registered bank. Choose `fact-or-cap`
or `fact-or-cap-anime` explicitly:

```powershell
npm run questions:publication -- review --target fact-or-cap --input games/fact-or-cap/incoming/general-candidate-001.json --classifications games/fact-or-cap/incoming/general-candidate-001-classifications.json --json --report games/fact-or-cap/research/publication-reports/general-candidate-001-review.json
```

For Anime, supply the explicit franchise assignment manifest instead:

```powershell
npm run questions:publication -- review --target fact-or-cap-anime --input games/fact-or-cap/incoming/anime-candidate-001.json --franchises games/fact-or-cap/incoming/anime-candidate-001-franchises.json --json --report games/fact-or-cap/research/publication-reports/anime-candidate-001-review.json
```

The General classification manifest is version 1 and uses the established
ledger-maintenance classification fields. It has one entry per question that
will be added:

```json
{
  "manifestVersion": 1,
  "classifications": [
    {
      "contentPackId": "general-candidate-001",
      "questionId": "example-question-id",
      "topicId": "life-sciences",
      "subtopicId": "animal-behavior",
      "questionType": "behavior",
      "underlyingClaimSummary": "A concise description of the underlying claim.",
      "repetitionReview": {
        "outcome": "no-known-overlap",
        "note": "Compared with the current ledger and published questions."
      }
    }
  ]
}
```

Use only topic, subtopic, and question-type identifiers present in the General
ledger. The Anime franchise manifest explicitly assigns every new question and
defines any new franchise; it does not infer a franchise from a display name:

```json
{
  "manifestVersion": 1,
  "franchises": [
    { "franchiseId": "example-series", "displayName": "Example Series", "aliases": [] }
  ],
  "entries": [
    { "questionId": "example-question-id", "franchiseId": "example-series" }
  ]
}
```

Before approval, review all report blockers and warnings, each question’s
duplicate matches, source metadata, classification/franchise assignments, and
the current ledger reconciliation. The report does not inspect source pages,
verify facts, or decide semantic equivalence. The editor must compare claims
and review quality manually. It does not assess licensing or reuse permission.

## 2. Understand report outcomes

- **Blocking errors** include invalid question/pack structure, invalid IDs,
  duplicate IDs within a candidate, conflicting existing IDs, unreadable
  published packs, an existing destination pack, and a ledger that does not
  reconcile. They prevent publication.
- **Exact and normalized matches** identify existing question IDs, game IDs,
  pack IDs, and pack files. Normalization is the existing conservative
  NFKC/lowercase/punctuation-to-space prompt-and-completion key. It preserves
  words, numbers, names, and negation. A match is a review signal, not proof of
  semantic equivalence.
- **Same ID, identical content** is an already-published record. It is not
  selected for a new pack.
- **Same ID, conflicting content** is blocked and cannot be waived by an
  approval manifest. Resolve it outside this workflow; published questions are
  never overwritten.
- **Warnings** require human attention. No semantic similarity algorithm is
  used. Claim-level overlap remains a human judgment.
- **Invalid entries** are reported with the original pack validator errors.
  The pipeline blocks the entire candidate; it never silently publishes only
  valid rows. Correct the candidate or prepare an explicitly reviewed split.

The preview command’s existing normalized duplicate warning can also be run
separately when desired:

```powershell
npm run questions:preview -- fact-or-cap games/fact-or-cap/incoming/general-candidate-001.json
```

## 3. Explicit approval and publication

Create a separate approval JSON only after reviewing the report. Copy the
candidate SHA-256 exactly from the report. Every candidate ID needs one
decision. Allowed outcomes are:

- `publish`: new ID with no normalized match.
- `publish-distinct`: normalized match reviewed and determined to be distinct;
  include a question-level rationale.
- `already-published`: same ID and identical content in the selected bank.
- `exclude`: explicitly exclude the question and include a rationale. The
  source candidate remains ineligible for cleanup while excluded material
  remains in it.

Example approval shape (replace all illustrative values):

```json
{
  "approvalVersion": 1,
  "target": "fact-or-cap",
  "contentPackId": "general-candidate-001",
  "candidateSha256": "COPY_FROM_REVIEW_REPORT",
  "ledgerMetadataSha256": "COPY_FROM_REVIEW_REPORT",
  "reviewerId": "editor-name",
  "approvedAt": "2026-10-19T12:00:00.000Z",
  "rationale": "Reviewed the complete candidate, source metadata, and duplicate report.",
  "decisions": [
    { "questionId": "example-question-id", "outcome": "publish" }
  ]
}
```

Publication requires a valid approval and the relevant ledger metadata:

```powershell
npm run questions:publication -- publish --target fact-or-cap --input games/fact-or-cap/incoming/general-candidate-001.json --classifications games/fact-or-cap/incoming/general-candidate-001-classifications.json --approval games/fact-or-cap/incoming/general-candidate-001-approval.json
```

For Anime, replace `--classifications` with `--franchises` and use the Anime
target. Publication creates a new pack named from `contentPackId`, updates only
the corresponding ledger, and writes a JSON receipt under
`games/fact-or-cap/research/publication-reports/`. Existing destination packs
are never overwritten. After the write, General reconciliation or Anime
membership reconciliation is checked before the transaction is considered
complete. The receipt contains the full pre-publication review report,
question-level decisions, candidate hash, published pack hash, and updated
ledger hash. The optional `review --report` output is a separate, no-overwrite
review snapshot and does not touch content, ledgers, or the candidate.

For General, run the familiar inventory and coverage checks after publication:

```powershell
npm run validate:questions -- fact-or-cap games/fact-or-cap/content/general/general-candidate-001.json
npm run report:question-inventory
npm run report:general-content-coverage
```

For Anime, validate and inventory the Anime bank:

```powershell
npm run validate:questions -- fact-or-cap-anime games/fact-or-cap/content/anime/anime-candidate-001.json
npm run report:question-inventory
```

`validate:questions` validates one specified pack. `report:question-inventory`
checks every loaded pack in both libraries and reports cross-bank ID and
normalized prompt/answer signals.

## 4. Recovery and candidate cleanup

Publication stages the new pack, ledger, and receipt, records a recovery
journal and ledger backup, uses no-overwrite creation for new files, verifies
written hashes, then marks the transaction committed. If a multi-file write
fails, it rolls back. If the process stops mid-transaction, the next workflow
command attempts recovery before continuing. Inspect the journal and preserve
the files if recovery reports that manual recovery is required:

```powershell
npm run questions:publication -- recover
```

Cleanup is a separate operation. First check eligibility; this does not delete
anything:

```powershell
npm run questions:publication -- cleanup --input games/fact-or-cap/incoming/general-candidate-001.json --report games/fact-or-cap/research/publication-reports/general-candidate-001.json
```

Only if every question is accounted for as published or identical content
already published, the candidate bytes match the receipt, the published pack
and ledger still match their recorded hashes, and reconciliation passes, may
the operator request deletion by repeating the exact pack ID:

```powershell
npm run questions:publication -- cleanup --input games/fact-or-cap/incoming/general-candidate-001.json --report games/fact-or-cap/research/publication-reports/general-candidate-001.json --confirm-delete general-candidate-001
```

An excluded question, any changed candidate or ledger, missing question, or
unreconciled state blocks cleanup. The command is limited to files under the
Fact-or-Cap incoming directory. Keep candidates with unresolved content; make
and validate a reviewed split before considering cleanup.

The report and approval record document operator decisions. Neither makes a
claim factually true, establishes that a source supports it, or clears content
for reuse. Those assessments remain separate editorial and rights-review work.
