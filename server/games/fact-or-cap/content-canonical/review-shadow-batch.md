# Offline review shadow batch

This plan selects ten existing legacy candidates for a future shadow review.
They are **not migrated by this plan**: there are no canonical records or
review decisions for these candidates yet, and the plan makes no factual,
source-support, or rights determination. The existing five-question pilot is
excluded from the count.

| Legacy game | Content pack | Question ID | Why include it in the experiment |
|---|---|---|---|
| `fact-or-cap` | `general-facts-batch-2026-10` | `saturn-ring-material` | Short entity/attribute completion; source is a specific NASA facts page. |
| `fact-or-cap` | `general-facts-batch-2026-10` | `ocean-average-salinity` | Numeric quantity and unit; test that the claim statement preserves the unit/context. |
| `fact-or-cap` | `general-facts-batch-2026-10` | `apollo-11-moonwalkers` | Partial personal name with punctuation; requires a literal rather than full-name entity completion unless exact resolution is justified. |
| `fact-or-cap` | `wildlife` | `wombat-cubes` | Separate older pack; answer is a descriptive phrase and source is a research publication attribution. |
| `fact-or-cap` | `wildlife` | `octopus-hearts` | Compound assertion with two answer clauses; likely requires editorial decomposition or exclusion. |
| `fact-or-cap-anime` | `anime-facts-batch-2026-10` | `spy-family-anya-ability` | Fictional character ability; tests source locator and claim wording review. |
| `fact-or-cap-anime` | `anime-facts-batch-2026-10` | `attack-on-titan-wall-maria` | Franchise/setting relationship and partial entity completion. |
| `fact-or-cap-anime` | `anime-facts-batch-2026-10` | `cells-at-work-red-cell-oxygen` | Fictionalized science content; requires separating real-world biological claim from story framing. |
| `fact-or-cap-anime` | `anime-foundations` | `anime-sailor-moon-luna` | Older anime pack; source page attribution may need a precise supporting passage/locator. |
| `fact-or-cap-anime` | `anime-foundations` | `anime-one-piece-roger` | Multi-part named answer and broad source attribution; test ambiguity and exact answer preservation. |

Candidate metadata above is copied from the current question packs. It is not
evidence that the source pages support the questions. Before canonical mapping,
reviewers should record an actual evidence locator or mark the source support
insufficient/unchecked. The plan intentionally includes likely editorial
exceptions so the workflow can show how flagged items are handled.

## Proposed batch exercise

1. Resolve each candidate's source material and claim wording manually; do not
   infer support from its URL or attribution title.
2. Create canonical records only for candidates with an unambiguous subject,
   claim, answer mapping, and usable source reference. Keep distinct assertions
   as distinct claims.
3. Record factual verification separately from every claim/source support
   decision, and record rights outcomes separately from approval for a named
   intended use. Missing decisions remain missing; unknown rights remain
   blocking.
4. Run canonical validation, adapter compatibility checks, migration parity
   where mapped, and the review readiness report. Review all flagged items and
   inspect the entire ten-item batch during this calibration run.
5. Record any false-clear or unclear state. Do not publish the batch; use the
   findings to refine review policy before considering a larger batch.

The exact machine-readable candidate identities used by the packet generator
are maintained in `review-shadow-batch.json`. Generate a read-only editor
packet from `server` with:

```sh
npm run report:review-packet
npm run report:review-packet -- --canonical <canonical.json> --migration <migration-manifest.json> --reviews <review-decisions.json> --intended-use <use-id>
```

Optional inputs enrich the packet; missing inputs leave explicit unresolved
mapping and review blockers. The packet does not create canonical records or
decisions and does not imply approval.

## Review manifest format and command

The sidecar format is version 1 and is defined by
`reviewDecisionManifest.js`. Each item is keyed by a canonical transformation
ID and records claim verification decisions, individual claim/source support,
source rights assessments, approvals for named intended uses, and an optional
rejected/withdrawn disposition. A decision includes reviewer, date, and
rationale; verified/disputed claims and checked source-support outcomes also
require an evidence locator. Determined rights outcomes require a documented
basis.

Run the report from `server`:

```sh
npm run report:content-readiness -- test/fixtures/canonical-review/fully-reviewed.json test/fixtures/canonical-review/synthetic-content.json --intended-use test-only
```

Exit status is 0 only when every manifest item meets the requested criteria,
1 when the report is valid but one or more items are not ready, and 2 for CLI
or input errors. Optional flags are `--migration <manifest.json>` to report
legacy parity separately, `--require-legacy-parity` to make parity a readiness
criterion, and `--allowed-rights permitted,public-domain` to configure accepted
rights outcomes. The default accepted rights outcomes are `permitted` and
`public-domain`.

`server/test/fixtures/canonical-review/` contains fully reviewed **synthetic test data only**. Its
specimen, evidence locators, reviewer, rights basis, and approval do not refer
to actual content and must not be treated as factual or legal findings.

The report keeps structural validity, adapter compatibility, legacy parity,
claim verification, source support, rights assessment, and intended-use
approval distinct. A passing report reflects recorded decisions and configured
criteria; it does not independently establish truth or provide legal advice.
