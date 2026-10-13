# Bruh wtf?

`bruh-wtf` is a separate server-authoritative prompt, answer and voting game.
It shares room/session lifecycle and configured 5/7/10 round counts with the
other registered games, but does not use Fact-or-Cap's content shape or scoring.
It requires at least three players so each voter has at least two anonymous
options after their own answer is excluded; with two players, the remaining
answer's author would be immediately inferable.

## Prompt-pack format (version 1)

Version 1 remains the runtime format. A pack contains only `formatVersion`,
`contentPackId`, `packType` and `questions`. `packType` is either
`development-fixture` or `production`. Pack IDs and question IDs are stable,
lowercase kebab-case slugs (`a-z`, `0-9`, and single hyphens). New pack
filenames should match their pack IDs; the existing development fixture keeps
its original filename for compatibility. A question contains `id`, `prompt`,
`requiredPlayers`, `category`, optional `tags`, and `contentPackId`, which must
equal its pack's ID. Unknown fields are rejected.

`requiredPlayers` is from 1 through 8. `{{player1}}` through
`{{playerN}}` must each appear exactly once, without gaps, and N must equal
`requiredPlayers`. The engine assigns distinct roster members and rejects an
ineligible question. Eight is the maximum number of named placeholders in one
prompt, not a room-size limit. Expanding it would require an explicit format
compatibility decision; the current room architecture has no corresponding
eight-player cap.

Categories are controlled IDs describing the prompt's main subject:
`absurd-hypotheticals`, `social-flirting`, `friend-roasts`, `creative-chaos`,
`survival-missions`, `group-chaos`, `ordinary-life`, `fictional-worlds`,
`confessions`, `adult-humor`, `pop-culture`, `work-life`, `money`,
`technology`, `mystery`, `competition`, and `fantasy-roles`. Tags are separate
descriptors: supported values currently cover tone (`tone-absurd`,
`tone-chaotic`, `tone-flirty`, `tone-roast`, `tone-surreal`,
`tone-wholesome`), targeting (`target-one`, `target-pair`, `target-group`),
and content lifecycle (`adult-content`, `trend-dependent`, `evergreen`). Tags
are metadata; they do not change game behavior or enforce category quotas.

The loader and offline validator use the same structural and cross-pack
validation. From `server/`, validate one pack or every JSON pack with:

```sh
npm run validate:bruh-wtf -- games/bruh-wtf/content/development-fixtures.json
npm run validate:bruh-wtf -- --all
```

Both modes are read-only. All-pack validation checks every file in `content/`,
including IDs and normalized prompts across packs. The runtime loader applies
the same rules and refuses an invalid library. The included pack is explicitly
a development fixture, not curated or production-quality content.

## Text integrity

Prompt validation rejects invalid UTF-8, U+FFFD, common mojibake signatures,
and likely apostrophe-to-question-mark corruption inside words. Ordinary
question marks, valid apostrophes (straight or typographic), and other Unicode
punctuation remain allowed. This deterministic pattern check is intentionally
narrow: it can miss unfamiliar encoding damage and a suspicious-looking string
may require human review. It reports the original filename, question ID and
matched substring; it never repairs text. The strict UTF-8 decoder is also
used by Fact-or-Cap/Anime pack parsing. The prompt-pattern scan is not enforced
on the existing Fact-or-Cap/Anime banks: an audit found existing suspicious
apostrophe substitutions, and enforcing them there would prevent those banks
from loading without the separately prohibited content repairs. Review those
findings before enabling fatal pattern checks on those banks.

## Adult content and editorial approval

The `adult-content` tag and `adult-humor` category identify material for
editorial review; they do not hide it. Current room/game configuration has no
adult-content opt-in or filtering mechanism. Do not publish adult prompts on
the assumption that metadata alone makes them opt-in. Add a product-level
consent and default-exclusion capability before exposing such a production
pack. Edgy personal humour and harsh roasts are allowed, but prompts must not
target protected traits with derogatory attacks or require truthful disclosure
of sensitive personal information.

Editorial guidance, category/template history and batch-audit records live in
`research/`, outside `content/` so the runtime cannot load them.

## Round and privacy contract

The server resolves placeholders, accepts one answer per participant, and
creates opaque answer-option IDs. During submission only progress is public.
During voting, each player sees anonymous answers other than their own; the
server independently checks ownership for every vote. Once votes are locked,
the server publishes authors, voter names, vote totals, +1-per-vote author
points, and the cumulative leaderboard. Results publish once, and all players
must continue before the next round. Final winners include all tied leaders.

When a player leaves mid-game, their active submissions, votes, score and
continuation readiness are removed. Votes targeting their answer are cleared
so affected players may vote again; completed quorums publish once. Two
remaining players may continue playing. Published round results remain
historical, while the public active leaderboard excludes departed players.
Future prompts are filtered or replaced to fit the remaining roster. If only
one player remains, the game session ends and the room returns to the lobby;
an empty room and session are removed. Host departure migrates the host and
does not abort the game.

## Development fixtures

The 11 prompts in `content/development-fixtures.json` exercise one-, two- and
three-player substitution, submission and result flows. They are mechanics
fixtures only and should be replaced or explicitly retained only after
editorial review.
