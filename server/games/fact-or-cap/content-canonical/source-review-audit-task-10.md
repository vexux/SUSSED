# Task 10 source review pilot (non-authoritative audit)

**Purpose:** record what was visible on the cited pages during a bounded source
inspection. This file is an audit note, not a canonical record, review decision,
factual verification, rights assessment, or approval for use. It does not change
the legacy question packs. Page inspection date: 2026-10-11.

## Scope and method

The three identities below were resolved using the offline review packet
(`node server/games/fact-or-cap/scripts/generate-review-packet.js`) and checked
against the corresponding legacy JSON packs. The packet resolves identity by
game, pack, and question ID. It labels the legacy source fields as attribution,
not reviewed evidence. All three candidates are currently `unmapped`, have no
canonical context or review-decision record, and have readiness `not-assessed`.

The cited source URLs were opened directly. Evidence locators below are page
section headings and line numbers from the accessible page rendering, not
permanent publisher-issued paragraph IDs. A source page's support finding does
not itself establish truth, rights, or suitability for a particular use.

## Findings

### `saturn-ring-material`

- **Legacy identity:** `fact-or-cap` / `general-facts-batch-2026-10` /
  `saturn-ring-material`; pack file
  `server/games/fact-or-cap/content/general-facts-batch-2026-10.json`.
- **Legacy record:** prompt “Saturn's rings are made mostly of chunks of ____ and
  rock.”; completion `ice`; category `space`; tags `Saturn`, `rings`,
  `solar-system`; difficulty `easy`. Source attribution: “NASA — Saturn Facts”,
  <https://science.nasa.gov/saturn/facts/>.
- **Claim under review:** Saturn's rings are made mostly of chunks of ice and
  rock. The answer slot asserts `ice`; the surrounding sentence additionally
  asserts ring material includes rock and that this composition is “mostly”.
- **Inspection:** cited NASA Saturn Facts page was accessible. In **Rings**,
  page lines 296–298, NASA says the rings “are made of billions of small chunks
  of ice and rock coated with other materials such as dust” and describes the
  range of particle sizes. This directly supports ice and rock as ring
  materials. The inspected passage does not quantify that those materials are
  “mostly” the rings' composition. That qualifier is not established by the
  located passage.
- **Assessment:** source is accessible and specific to Saturn's rings. Evidence
  found for ice and rock; wording qualifier “mostly” remains unsupported by the
  passage located. No finding here independently verifies the claim.
- **Follow-up:** an editor should decide whether to remove/justify “mostly” in a
  future canonical transformation, and record a precise evidence locator and
  separate claim/source-support decision. No question wording was changed here.
- **Other unresolved items:** verify the exact claim wording against the source
  and assess rights for a named intended use. Public NASA accessibility and
  attribution are not a rights determination.

### `octopus-hearts`

- **Legacy identity:** `fact-or-cap` / `wildlife` / `octopus-hearts`; pack file
  `server/games/fact-or-cap/content/wildlife.json`.
- **Legacy record:** prompt “An octopus has three hearts, and its blood is...”;
  completion `blue`; category `wildlife`; tags `marine-life`, `biology`;
  difficulty `easy`. Source attribution: “Encyclopaedia Britannica”,
  <https://www.britannica.com/animal/octopus-mollusk>.
- **Assertions evaluated separately:** (1) an octopus has three hearts; (2) an
  octopus's blood is blue. These are distinct biological claims combined in one
  question; the answer slot completes only the second assertion.
- **Inspection:** the cited Britannica URL could not be opened by the available
  page inspector (non-retryable open error). No passage, section, or page
  locator from that page was available to inspect. The page's title and URL in
  the repository are attribution metadata only.
- **Assessment:** **neither assertion is assessed against the cited page**. The
  access failure is not evidence that either assertion is unsupported or false.
  Source accessibility and specificity cannot be determined from the page
  contents in this review.
- **Follow-up:** an editor must access the cited Britannica article in a
  suitable browser and record separate locators for heart count and blood
  colour, or mark each source/claim relationship insufficient and identify an
  inspectable source. Do not fill in evidence from search snippets. Independently
  resolve the one-claim-per-transformation constraint: the existing Fact-or-Cap
  adapter accepts exactly one claim per transformation. A future migration
  would need a documented editorial split/rewrite into separate playable
  transformations/questions, or defer this combined item. This audit does not
  rewrite it.
- **Other unresolved items:** establish factual verification and source support
  per assertion, then assess rights and approval separately. None is recorded
  here.

### `spy-family-anya-ability`

- **Legacy identity:** `fact-or-cap-anime` /
  `anime-facts-batch-2026-10` / `spy-family-anya-ability`; pack file
  `server/games/fact-or-cap/content/anime/anime-facts-batch-2026-10.json`.
- **Legacy record:** prompt “In SPY×FAMILY, adopted daughter Anya can read other
  people's ____.”; completion `minds`; category `characters`; tags
  `spy-x-family`, `Anya-Forger`, `ability`; difficulty `easy`. Source attribution:
  “SPY×FAMILY — TV Series”, <https://spy-family.net/tvseries/>.
- **Claim under review:** the character Anya can read other people's minds;
  context also identifies her as the adopted daughter in the question.
- **Inspection:** the cited official TV series page was accessible. Its
  **STORY** passage at lines 184–204 explains the family premise and line 200
  describes the daughter Anya as a supernatural ability user who can read
  minds. More specifically, the **CHARACTER** entry headed ANYA FORGER at lines
  323–334 identifies her as the Forger family's daughter and describes her as
  a psychic who can read other people's minds (line 334). Thus the located
  character passage directly addresses the ability; this is more than general
  franchise identification or cast information.
- **Assessment:** the accessible page is specific enough to locate direct
  support for the fictional character's ability and daughter relationship.
  The character entry calls her the Forger family's daughter and says Loid
  took her in from an orphanage, but the inspected passage does not use the
  specific word “adopted”; that part of the prompt is not stated explicitly on
  this page. The page establishes what the official series site says about its
  fiction; it is not an external-world factual claim. This inspection is not a
  formal verification decision.
- **Follow-up:** record the exact page section/locator in a canonical source and
  review record if this candidate is migrated. Clarify provenance/publisher
  identity for the official site and assess rights for the intended use; neither
  is settled by the page content or attribution string.

## Review dimensions kept separate

| Candidate | Page accessibility and located claim evidence | Factual/claim verification decision | Rights / reuse status | Intended-use approval |
|---|---|---|---|---|
| `saturn-ring-material` | NASA page accessible; ice and rock located; “mostly” not quantified in located passage | Not recorded | Not assessed | Not recorded |
| `octopus-hearts` | Britannica page inaccessible; both assertions unassessed against cited page | Not recorded | Not assessed | Not recorded |
| `spy-family-anya-ability` | Official series page accessible; Anya character entry states mind-reading ability | Not recorded | Not assessed | Not recorded |

No candidate is approved or ready for use. Do not copy these observations into
review-decision records as completed decisions without an identified reviewer,
rationale, exact evidence locator, and the workflow's required decision
metadata.

## Packet workflow observations

The current packet preserves exact legacy identity, prompt/completion and
repository attribution, and clearly labels attribution as not reviewed
evidence. It does not ingest or display an independent source-review audit
artifact. Because these candidates have no migration mapping, it cannot attach
page findings to canonical source/claim IDs or decision records. Accordingly,
the packet remains `unmapped`, review decisions remain missing, and readiness
remains `not-assessed`; the findings above are kept outside the workflow's
approval state. This is appropriate for this read-only pilot, but any later
migration needs explicit canonical mappings and reviewed locators rather than
an inferred link from source names or URLs.

## Files inspected

- `server/games/fact-or-cap/content-canonical/review-shadow-batch.json`
- `server/games/fact-or-cap/content-canonical/review-shadow-batch.md`
- `server/games/fact-or-cap/content-canonical/README.md`
- `server/games/fact-or-cap/reviewPacket.js`
- `server/games/fact-or-cap/reviewDecisionManifest.js`
- `server/games/fact-or-cap/canonicalContent.js`
- The three legacy pack files listed in the candidate sections above.
