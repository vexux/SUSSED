# Fake Answer

## Question library

Question content lives in JSON packs under `content/`; the game engine reads
the validated library through `questionBank.js`. Existing player-facing fields
remain `id`, `text`, and `correctCompletion`. Source attribution
(`sourceName`/`sourceUrl`) and optional `category`, `tags`, `difficulty`, and
`contentPackId` metadata are stored separately and are not included in public
game-state projections.

To add a pack, create a JSON file in `content/` with a top-level
`contentPackId` and a `questions` array. Each entry needs a unique stable `id`,
non-empty `text`, and non-empty `correctCompletion`. Source title and URL are
optional, but missing attribution is reported by the validation tool. Sources
should be verified and have suitable reuse rights before content is added.
Optional difficulty values are `easy`, `medium`, or `hard`.

Validate a candidate file before adding it:

```sh
cd server
npm run validate:questions -- path/to/candidate-pack.json
```

The validator reports blocking schema/ID errors, missing-source warnings, and
likely duplicate-content candidates. It never writes to or overwrites the
library. Duplicate detection compares normalized prompt-and-answer pairs
(Unicode normalization, case folding, and punctuation/spacing normalization);
it warns rather than deleting content.

The game shuffles valid playable questions and selects five unique prompts per
session. If a session needs more prompts than the library contains, game start
fails with `QUESTION_POOL_EXHAUSTED`. A new session avoids questions used by
the immediately preceding session when enough unused questions remain; when
the library is too small for that, it fills the selection from previously used
questions while still preventing repeats within the session.

## Scoring

After every player has voted, the server publishes round results and updates the
scores exactly once for that round:

- A correct vote for the real completion earns the voter 1 point.
- Each vote for a fake completion earns its author 1 point.
- The result separates a player's correct-vote points from points earned for
  votes on their bluff; their round delta is the sum of those two rewards.
- Players cannot vote for their own fake completion.
- The real completion has no player author.
- A player can earn both the correct-vote point and points from votes for their
  fake completion in the same round.
- An incorrect vote earns no correct-vote point; the player can still earn
  points if other players selected their fake completion.
- Each accepted vote is keyed to one opaque option ID. Results resolve that ID
  back to one answer, author, and voter list before awarding points.

## Round and disconnect lifecycle

After results are published, every player in the game-start roster must send
Continue before the next round begins. A fresh opaque round ID protects answer,
vote, and continuation requests from delayed events belonging to an earlier
round. The prompt order is shuffled without replacement; starting fails
explicitly if the validated question library contains fewer prompts than the
configured round count.

The participant roster is fixed when the game starts. If a player disconnects
or leaves before the game finishes, the server aborts and retires that active
session and returns any remaining room members to the lobby unready. This
avoids changing a round's submission or vote quorum after actions have been
accepted. A finished session remains available for results and host-driven
return to the lobby after a membership change. If all room members leave, the
existing room cleanup removes the game session and room.

Submission, voting, and between-round continuation phases have no inactivity
deadline. Players may wait in these phases indefinitely; only an actual
disconnect follows the existing session-abort and lobby-recovery policy.
Submission progress exposes player IDs, names, and submitted status only; it
never includes answer contents or authorship before reveal.

After final results, the room remains in its in-game state until the host
returns it to the lobby. The server retires the finished session, resets every
remaining member's ready state, and preserves the room code, host, membership,
and selected game. Starting again creates a new generic session and initializes
new fake-answer state, including fresh scores and a fresh round ID. Each generic
session has an opaque session ID so clients can ignore delayed state updates
from a retired session.
