# Bruh wtf?

`bruh-wtf` is a separate server-authoritative prompt, answer and voting game.
It shares room/session lifecycle and configured 5/7/10 round counts with the
other registered games, but does not use Fact-or-Cap's content shape or scoring.
It requires at least three players so each voter has at least two anonymous
options after their own answer is excluded; with two players, the remaining
answer's author would be immediately inferable.

## Prompt-pack format (version 1)

Each JSON pack contains `formatVersion: 1`, a stable `contentPackId`, a
`packType` (`development-fixture` or `production`), and a `questions` array.
Each question has a stable `id`, `prompt`, `requiredPlayers` (1–8), `category`,
optional `tags`, and a `contentPackId` equal to its pack's ID. Placeholder
tokens are `{{player1}}` through `{{playerN}}`; every slot must appear exactly
once, with no gaps. The engine assigns slots to distinct roster members and
rejects an ineligible question before a game starts. IDs, not prompt text,
identify individual records; normalized prompts are checked for duplicates.

The loader validates all packs under `content/` at runtime. Validate a pack
offline from the `server` directory with:

```sh
node games/bruh-wtf/validate-question-pack.js games/bruh-wtf/content/development-fixtures.json
```

The included pack is explicitly a development fixture, not curated or
production-quality content. Future content authoring and duplicate-review
guidance is in `research/`.

## Round and privacy contract

The server resolves placeholders, accepts one answer per participant, and
creates opaque answer-option IDs. During submission only progress is public.
During voting, each player sees anonymous answers other than their own; the
server independently checks ownership for every vote. Once votes are locked,
the server publishes authors, voter names, vote totals, +1-per-vote author
points, and the cumulative leaderboard. Results publish once, and all players
must continue before the next round. Final winners include all tied leaders.

## Development fixtures

The 11 prompts in `content/development-fixtures.json` exercise one-, two- and
three-player substitution, submission and result flows. They are mechanics
fixtures only and should be replaced or explicitly retained only after editorial
review.
