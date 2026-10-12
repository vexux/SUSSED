# Batch audit: `<contentPackId>`

- **Review date:** `YYYY-MM-DD`
- **Pack file / type / format:** `path.json` / `production` / `1`
- **Reviewer(s):** `names or team`
- **Disposition:** `under review | accepted | rejected | mixed`

## Questions and validation

List every question ID and its editorial decision (`accepted`, `rejected`, or
`retired`), category ID, template-family ID, and premise fingerprint. Record
the exact command and result:

```sh
npm run validate:bruh-wtf -- <candidate-pack.json>
npm run validate:bruh-wtf -- --all
```

Record schema errors and text-integrity findings by filename, question ID and
reported substring. Validation is structural; it is not editorial approval.

## Coverage and originality

- Category coverage (descriptive counts only; there are no quotas):
- Template-family/premise coverage:
- Exact normalized prompt duplicates (must be resolved before acceptance):
- Potential semantic overlaps with accepted questions, rejected history or
  recent batches (human review; include compared IDs and disposition):
- Overrepresented target patterns or expected-answer spaces:

Compare the comedic premise, targeting pattern and expected answer space. A
fingerprint is an index for review, not proof of semantic identity.

## Editorial decisions and trends

For each rejected/retired candidate, record a specific reason such as exact
duplicate, generic premise, weak comedic premise, unclear prompt, unsuitable
content or expired trend. Do not treat an individual rejection as a category
ban. Record trend references and whether each prompt remains understandable
and useful if the trend fades.

## Adult-content and audience review

List content tagged `adult-content` and record the intended audience and
release restrictions. Current gameplay has no adult opt-in; do not release
adult material until a separate product-level consent/default-exclusion
capability exists.
