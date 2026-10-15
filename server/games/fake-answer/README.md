# Fact or Cap

## Game variants

The registered game IDs are `fact-or-cap` and `fact-or-cap-anime`. Both IDs
use the same submission, voting, scoring, reveal, round, and rematch engine.
The general game reads packs only from `content/`; the Anime game reads packs
only from `content-anime/`. Each bank has independent question selection history.
Each game variant has a curated library of playable, source-attributed
questions. Rooms require at least two players and have no application-level
player maximum. The host can choose 5, 7, or 10 rounds in the lobby; new rooms
default to five. Each selected game session requires at least that many valid
questions and reports `QUESTION_POOL_EXHAUSTED` if its bank is too small.
Practical capacity still depends on available server memory, process resources,
and Socket.IO transport capacity. Room codes also come from a finite code pool,
which limits simultaneously active rooms independently of player count.

The selected round count is stored in the authoritative room state, included in
lobby broadcasts, and passed to the shared game engine at start. Only the host
can change it, and the server accepts only 5, 7, or 10 using the current lobby
revision. Changing the selection clears guest readiness so players confirm the
updated match settings.

## Question library

General-game question content lives in JSON packs under `content/`; the Anime
library lives separately under `content-anime/`. The shared engine reads each
validated library through its own question bank. Existing player-facing fields
remain `id`, `text`, and `correctCompletion`. Source attribution
(`sourceName`/`sourceUrl`) and optional `category`, `tags`, `difficulty`, and
`contentPackId` metadata are stored separately and are not included in public
game-state projections.

New candidate batches go in the shared, offline
[`incoming/` folder](incoming/README.md), outside both runtime content
directories. The runtime loads JSON only from `content/` and `content-anime/`;
it never scans `incoming/`. The canonical/migration workflow in
`content-canonical/` and Bruh wtf?'s separate prompt-pack workflow are not part
of this importer.

The incoming-batch instructions document the current legacy question format,
stable ID and pack-ID conventions, read-only preview, explicit import, source
requirements, duplicate approval, validation, and checking published counts.
Preview reports structural/ID issues, source metadata issues, and exact
normalized prompt/completion matches. Review cited evidence, factual support,
wording, game quality, and reuse rights separately; preview does not fetch
sources or approve content. Run `npm run report:question-inventory` from
`server/` for a read-only report of published packs, question totals, validation
failures, and normalized duplicate matches.

For General Fact-or-Cap planning, see the
[`research/general-question-generation-guide.md`](research/general-question-generation-guide.md)
and its reconciled
[`research/general-topic-ledger.json`](research/general-topic-ledger.json).
The guide records editorial generation and review practice; the ledger indexes
published question identities and provisional topic/claim classifications to
help plan coverage and spot possible repetition. Published JSON packs remain
the only runtime content. New candidates stay in `incoming/` until reviewed
and explicitly imported. Update the ledger only after accepted questions are
present in published packs, then reconcile identity and pack membership
against the inventory as described in the guide. The ledger does not replace
the inventory, canonical records, or human source review, and it does not
establish factual accuracy, source support, or rights.
Run `npm run report:general-content-coverage` from `server/` to reconcile its
stable identities with published General packs and review provisional topic,
subtopic, and question-type coverage. The report is read-only; see the guide for
the configurable low-coverage threshold and interpretation of its warnings.
After importing a reviewed General batch, prepare explicit provisional
classifications and use `npm run update:general-topic-ledger` to preview, then
`--apply` to atomically update the ledger. The maintenance workflow and
recovery procedure for a forgotten ledger update are documented in the General
guide and `incoming/README.md`.

The game shuffles valid playable questions and selects the configured number of
unique prompts per session (5, 7, or 10). If a session needs more prompts than
the library contains, game start fails with `QUESTION_POOL_EXHAUSTED`. A new session avoids questions used by
the immediately preceding session when enough unused questions remain; when
the library is too small for that, it fills the selection from previously used
questions while still preventing repeats within the session.

## Scoring

After every player has voted, the server publishes round results and updates the
scores exactly once for that round:

- A correct vote for the real completion earns the voter 2 points.
- Each vote for a fake completion earns its author 1 point.
- Every eligible vote for a fake answer grants its author one point; multiple
  votes on the same fake answer each award one point.
- The result separates a player's correct-vote points from points earned for
  votes on their bluff; their round delta is the sum of those two rewards.
- Players cannot vote for their own fake completion.
- The real completion has no player author.
- A player can earn both correct-vote points and points from votes for their
  fake completion in the same round.
- An incorrect vote earns no correct-vote reward; the player can still earn
  points if other players selected their fake completion.
- Each accepted vote is keyed to one opaque option ID. Results resolve that ID
  back to one answer, author, and voter list before awarding points.

## Answer integrity and presentation

An answer is rejected with the same generic duplicate message if its Unicode
NFKC-normalized, case-folded text (with leading/trailing and repeated
whitespace normalized) exactly matches the real completion or another
submitted answer. Punctuation and wording are otherwise significant; this is
deliberately exact matching, not fuzzy matching. The rejected response does
not include the matching text or reveal which answer it matched. Canonical
answers remain unchanged in game state; public answer projections are rendered
in lowercase consistently for the real and submitted completions.

## Round and disconnect lifecycle

After results are published, every player in the game-start roster must send
Continue before the next round begins. A fresh opaque round ID protects answer,
vote, and continuation requests from delayed events belonging to an earlier
round. The prompt order is shuffled without replacement; starting fails
explicitly if the validated question library contains fewer prompts than the
configured round count.

Between rounds, the public results projection includes each roster player's
ID, name, and ready-to-continue status; it does not include answers or votes.
The fifth round publishes a distinct final-results projection after all votes
are complete. Its leaderboard and winner ties use cumulative server scores,
with player IDs as the deterministic ordering for equal scores. Final fun
statistics are accumulated from each completed round's validated vote-to-option
mapping: fake votes received by bluff authors, votes cast for another player's
bluff, and correct votes for the real completion. Tied statistic leaders are
all retained, and a statistic with no qualifying votes has no winner. These
aggregates are session-local and start at zero for every rematch.

Round results also give each viewer a dismissible, short-lived personal
feedback message derived from their own revealed vote. It is hidden until
results are published and does not affect the normal answer or score breakdown.

The server removes a disconnecting or voluntarily leaving player from the
active session and reevaluates the current phase against the remaining roster.
Their submission, vote, score, and statistics are removed. Votes for their
bluff are invalidated so affected players can vote again; if the remaining
submission or vote quorum is already complete, the server advances once. If
one player remains, the session ends and that player returns to the lobby
unready. An empty room and its session are deleted. Host migration does not
interrupt an active game. Departed sockets cannot read state or act in the
session, and session/round IDs continue to guard delayed events.

Bruh wtf? keeps already-published round results as historical data after a
departure while exposing an active leaderboard for the remaining players.
Future prompts are restricted to the new roster size. If a selected prompt
cannot be replaced from the eligible library, the remaining session's round
count is shortened to the available sequence.

Submission, voting, and between-round continuation phases have no inactivity
deadline. Players may wait in these phases indefinitely while the remaining
players are still participating.
Submission progress exposes player IDs, names, and submitted status only; it
never includes answer contents or authorship before reveal.

After final results, the room remains in its in-game state until the host
returns it to the lobby. The server retires the finished session, resets every
remaining member's ready state, and preserves the room code, host, membership,
and selected game. Starting again creates a new generic session and initializes
new game state, including fresh scores and a fresh round ID. Each generic
session has an opaque session ID so clients can ignore delayed state updates
from a retired session.
