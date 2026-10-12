# Bruh wtf? question-generation and review guide

This directory is research/editorial material. It is outside `content/` and is
never loaded as playable content.

## Authoring rules

- Use stable kebab-case question IDs and stable category IDs.
- Every prompt must be understandable when player names are inserted.
- Use `{{player1}}` through `{{playerN}}` exactly once each and set
  `requiredPlayers` to `N`; the runtime assigns distinct people.
- Keep reusable template concepts varied. Compare new prompts with the
  category/template ledger and the entire playable prompt library.
- Keep answer space open-ended, avoid asking for personal or sensitive
  disclosures, and review for cultural/contextual ambiguity before production.
- Mark draft fixtures as `development-fixture`; only reviewed batches should be
  labeled `production`.

## Batch audit reports

Place a report for each proposed production batch in `batch-audits/`. Record
pack ID, question IDs, validation command/result, duplicate checks, editorial
flags and disposition. A structurally valid pack is not thereby editorially
approved.
