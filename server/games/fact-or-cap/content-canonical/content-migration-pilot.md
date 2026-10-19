# Five-question canonical migration pilot

This is a controlled, offline migration sample for five existing questions. It
does not feed either live question bank and does not change question selection
or gameplay. The canonical records are in `content-migration-pilot.json`; the
one-to-one legacy links are in `content-migration-pilot-manifest.json`.

## Selected records and mapping decisions

| Legacy ID | Game / source pack | Canonical mapping |
|---|---|---|
| `mercury-nearest-sun` | `fact-or-cap` / `general-facts-batch-2026-10` | `entity:mercury` and `entity:sun`; claim `claim:mercury-nearest-sun`; answer resolves to the full entity name `Mercury`. |
| `mercury-shortest-year` | `fact-or-cap` / `general-facts-batch-2026-10` | Reuses `entity:mercury`, relates it to `entity:earth`, and has a separate orbital-period claim. Completion `88` is literal because it is numeric, not an entity display name. |
| `ocean-earth-surface` | `fact-or-cap` / `general-facts-batch-2026-10` | `entity:ocean` and `entity:earth`; a distinct surface-coverage claim with literal completion `70`. |
| `octopus-ink-defense` | `fact-or-cap` / `general-facts-batch-2026-10` | `entity:common-octopus` and `entity:ink`; completion resolves to the exact display name `ink`. |
| `one-piece-nami` | `fact-or-cap-anime` / `anime-facts-batch-2026-10` | Reuses the One Piece series entity for `entity:nami` and `entity:straw-hat-crew`; completion resolves to the exact display name `Nami`. |

All five prompts, completions, categories, tags, difficulty values, source
titles, and source URLs were copied from the identified legacy records. The
manifest uses each pack's top-level `contentPackId`; the playable questions
inherit that same ID. The Mercury records share one canonical Mercury entity,
but remain separate claims because they assert different facts. Each selected
question cites a different title/URL pair, so this pilot does not merge source
records that only happen to be in the same topic area.

## Review status and limitations

The source title and URL fields preserve the existing attribution only. No
source page was opened as part of this pilot, so source support for each claim
has not been checked. Access dates are `null`; source, claim, entity, and
transformation review statuses are `unreviewed`; claim verification is
`unverified`; and rights status remains `unknown` with a null license. Nothing
here asserts factual accuracy or permission to reuse.

The canonical schema stores claim statements as text, so quantities and units
remain in the statement and Fact-or-Cap payload rather than typed data. The
adapter is intentionally not connected to runtime banks. A manifest parity
match means generated playable fields equal the current legacy fields; it does
not mean the record is ready to publish.

## Repeatable validation

From the `server` directory:

```sh
npm run validate:canonical -- games/fact-or-cap/content-canonical/content-migration-pilot.json
npm run validate:migration -- games/fact-or-cap/content-canonical/content-migration-pilot-manifest.json games/fact-or-cap/content-canonical/content-migration-pilot.json
node --test test/contentMigrationPilot.test.js test/factOrCapAdapter.test.js
```

The migration validator reports each field difference and the canonical
verification/review/rights metadata. It does not rewrite either document or
the source packs.
