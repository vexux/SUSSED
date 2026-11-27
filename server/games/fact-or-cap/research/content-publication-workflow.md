# Fact-or-Cap Content Publication Workflow

Use this offline workflow for General and Anime candidate packs. Published JSON
packs remain the runtime source of playable questions. The General topic ledger
and Anime franchise ledger remain separate supporting research records; neither
is evidence of factual accuracy or rights clearance.

Run commands from `server/`. The legacy CLI also checks for an interrupted transaction before dispatch and can recover it. Use the Studio preview for a strictly read-only calculation.

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
or `fact-or-cap-anime` explicitly. Review output is printed to the terminal; do
not save permanent review reports in the repository:

```powershell
npm run questions:publication -- review --target fact-or-cap --input games/fact-or-cap/incoming/general-candidate-001.json --classifications $env:TEMP/general-candidate-001-classifications.json --json
```

For Anime, supply the explicit franchise assignment manifest instead:

```powershell
npm run questions:publication -- review --target fact-or-cap-anime --input games/fact-or-cap/incoming/anime-candidate-001.json --franchises $env:TEMP/anime-candidate-001-franchises.json --json
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

Before approval, review all blockers and warnings printed by the command, each question’s
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

Create a temporary approval JSON outside the repository only after reviewing
the terminal output. Copy the candidate SHA-256 exactly from that output. Keep
approval, classification/franchise manifests, and source-audit working files
outside the repository when practical; do not archive them under `research/`.
Every candidate ID needs one decision. Allowed outcomes are:

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
  "candidateSha256": "COPY_FROM_REVIEW_OUTPUT",
  "ledgerMetadataSha256": "COPY_FROM_REVIEW_OUTPUT",
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
npm run questions:publication -- publish --target fact-or-cap --input games/fact-or-cap/incoming/general-candidate-001.json --classifications $env:TEMP/general-candidate-001-classifications.json --approval $env:TEMP/general-candidate-001-approval.json
```

For Anime, replace `--classifications` with `--franchises` and use the Anime
target. Publication creates a new pack named from `contentPackId` and updates
only the corresponding ledger. Existing destination packs are never
overwritten. After the write, General reconciliation or Anime membership
reconciliation is checked before the transaction is considered complete. A
hash-bound receipt is kept temporarily under the operating system temp
directory solely so guarded cleanup can verify the candidate, published pack,
and current ledger. The CLI prints its path. The receipt is outside the
repository and is deleted after successful guarded cleanup. Optional review
snapshots (`--snapshot`) also go only to that temp directory; terminal output
is sufficient for normal review. Do not create or retain a publication-report
archive in the repository.

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
$receipt = Read-Host "Temporary receipt path printed by publish"
npm run questions:publication -- cleanup --input games/fact-or-cap/incoming/general-candidate-001.json --receipt $receipt
```

Only if every question is accounted for as published or identical content
already published, the candidate bytes match the receipt, the published pack
and ledger still match their recorded hashes, and reconciliation passes, may
the operator request deletion by repeating the exact pack ID. Paste the
temporary receipt path printed by `publish` when prompted:

```powershell
$receipt = Read-Host "Temporary receipt path printed by publish"
npm run questions:publication -- cleanup --input games/fact-or-cap/incoming/general-candidate-001.json --receipt $receipt --confirm-delete general-candidate-001
```

An excluded question, any changed candidate or ledger, missing question, or
unreconciled state blocks cleanup. The command deletes only the candidate
under the Fact-or-Cap incoming directory and, after verification, its
temporary receipt. It does not archive review paperwork. Keep candidates with
unresolved content; make and validate a reviewed split before considering
cleanup.

The temporary receipt and approval input document operator decisions during
the publication operation. Neither makes a
claim factually true, establishes that a source supports it, or clears content
for reuse. Those assessments remain separate editorial and rights-review work.

## 5. Studio publication and promotion

From the repository root on `dev`, run `npm --prefix studio run dev` and open
`http://127.0.0.1:43202`. The API listens on loopback port 43201. Keep both
processes local. Studio uses the operator's existing Git and GitHub credentials.

1. Open an Anime or General candidate from Incoming. Save edits and record the editorial checklist. Preview reads the latest review, the original bytes of the candidate and sidecar, both banks and the target ledger. The publisher-compatible metadata hash covers parsed JSON. The editorial sidecar binding covers its original bytes. Choose a disposition for every question and supply rationale for exclusions and duplicate overrides.
2. Inspect exact output bytes, original ledger, duplicate matches, inventory and SHA-256 hashes. Download evidence to retain the source bytes and decision record. Evidence contains editorial notes. A simulation against dev can be exported; publishing requires recalculation in the dedicated data worktree.
3. In the Incoming publication workflow, review **Set up data worktree**. Confirming it creates a sibling checkout at the development repository path suffixed with `-data`. The local and remote dev heads must match. Existing data worktrees must be registered in this repository. An existing divergent branch or occupied directory requires inspection. The setup does not switch the development checkout.
4. In the editor confirm **Publish these files locally**. One transaction installs the pack, ledger, temporary CLI-format evidence, and a Git-trackable receipt at `server/games/fact-or-cap/research/publication-receipts/<transactionId>.json`. Retain temporary evidence through the commit step. The tracked receipt identifies its parent and exact resulting content. Git supplies the resulting commit ID after committing. Keep source drafts and review history in their original dev checkout.
5. Refresh receipts and select the transaction. **Check progress** identifies the next step from the filesystem, commits, remote refs and matching PR. **Review commit**, **Review push**, **Review pull request** and **Review merge** each show the intended action and require separate confirmation. Commit writes a verified Git tree containing only three files and advances data using its expected old commit. This uses Git plumbing and does not invoke normal commit hooks. Push is restricted to the verified fast-forward or first creation of remote data.
6. GitHub actions use an authenticated `gh` with access to `vexux/SUSSED`. If unavailable, review the exact pushed commit at [the data-to-dev comparison](https://github.com/vexux/SUSSED/compare/dev...data), confirm the three files and open or reuse that PR. Review and merge separately. Use a merge commit so the verified publication commit is an ancestor of dev. Keep the local data worktree available through verification. Remote dev can be verified even if GitHub deletes the merged head branch. **Verify integration** checks remote dev independently of local dev or GitHub CLI, including the receipt, both output blobs, selected IDs, complete inventory and target ledger reconciliation.
7. After verification, **Review original cleanup** identifies the two exact incoming files. Excluded material, changed review, missing evidence or changed bytes block cleanup. The operation keeps restart evidence under Studio's ignored local directory. Repeat the same confirmed cleanup to resume. Refresh local dev through the usual reviewed workflow before the next publication.

### Interrupted publication

The transaction directory is exclusive. A version-2 journal records the owner, hashes and exact destinations before staging. The publisher retains hard links to identify installed files and displaces the old ledger into the recovery directory before exclusive installation of its replacement. The pack, ledger and receipt locations must support hard links; the ledger and its backup must share a filesystem. File data is synced, and directory entries are synced on platforms that support it through Node.

Use **Inspect transaction recovery** in the data worktree workflow. A confirmed recovery first checks every file. Prepared transactions roll back; committed transactions verify installed bytes and finish cleanup. A different process cannot take over a live local publisher or recovery owner. A missing or invalid journal, unidentifiable owner, unexpected directory entry, or conflicting bytes requires manual inspection. Preserve the directory, the two receipt locations and both versions of the ledger. Do not retry publication against an ambiguous worktree. After rollback, generate a fresh preview and confirm again. After committed cleanup, resume from the tracked receipt. For a lost HTTP response, inspect progress before retrying any step.

Private local review files and exported evidence are separate from the Git-tracked receipt. Keep local Studio state and temporary evidence available throughout an active operation. GitHub rules, credentials and the operator's filesystem can independently refuse a step; Studio leaves completed earlier steps available for inspection.
