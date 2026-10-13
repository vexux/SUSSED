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

To add a general pack, create a JSON file in `content/`; add an Anime pack in
`content-anime/`. Use a top-level
`contentPackId` and a `questions` array. Each entry needs a unique stable `id`,
non-empty `text`, and non-empty `correctCompletion`. Source title and URL are
optional in the base schema, but missing attribution is reported by the
validation tool. Batch imports require both source fields. Sources should be
verified and have suitable reuse rights before content is added.
Optional difficulty values are `easy`, `medium`, `hard`, and `extremely-hard`.

Validate a candidate file before adding it:

```sh
cd server
npm run validate:questions -- path/to/candidate-pack.json
npm run validate:questions -- fact-or-cap-anime path/to/anime-pack.json
```

For a multi-question batch, preview it against an explicitly selected game
library before importing. Batches require a top-level `contentPackId`; imports
create a new pack and never replace an existing file. Likely normalized
prompt-and-answer duplicates need explicit approval:

```sh
cd server
npm run questions:preview -- -- --target fact-or-cap --input path/to/batch.json
npm run questions:import -- -- --target fact-or-cap --input path/to/batch.json
npm run questions:import -- -- --target fact-or-cap-anime --input path/to/anime-batch.json
```

Preview is read-only and reports validation errors, missing-source warnings,
duplicate IDs, likely duplicate content, and accepted/rejected counts. Likely
duplicate matches include the candidate ID and matching game, content pack,
question ID, and whether the match is within the target bank or across banks.
Preview compares against both registered banks and earlier candidates in the
same batch. Imports
validate again and install the pack atomically without overwriting a competing
or existing pack. These checks enforce structure and deduplication heuristics;
they do not replace editorial verification of each claim, source, or gameplay
quality.

The validator reports blocking schema/ID errors, missing-source warnings, and
likely duplicate-content candidates. It never writes to or overwrites the
library. Duplicate detection compares normalized prompt-and-answer pairs
(Unicode normalization, case folding, and punctuation/spacing normalization)
within the selected bank, across the two registered banks, and within the
candidate batch. It reports each matching question separately and keeps ID
conflicts distinct from content matches. Exact normalized matches are a useful
review signal, not proof of semantic equivalence; paraphrases and related facts
may not match, and unrelated content can still normalize to the same pair. The
tool warns and requires explicit import approval rather than deleting content.

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
