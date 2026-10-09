# Fake Answer scoring

After every player has voted, the server publishes round results and updates the
scores exactly once for that round:

- A correct vote for the real completion earns the voter 1 point.
- Each vote for a fake completion earns its author 1 point.
- Players cannot vote for their own fake completion.
- The real completion has no player author.
- A player can earn both the correct-vote point and points from votes for their
  fake completion in the same round.
- An incorrect vote earns no correct-vote point; the player can still earn
  points if other players selected their fake completion.

## Round and disconnect lifecycle

After results are published, every player in the game-start roster must send
Continue before the next round begins. A fresh opaque round ID protects answer,
vote, and continuation requests from delayed events belonging to an earlier
round. The prompt order is shuffled without replacement; starting fails
explicitly if the curated bank contains fewer prompts than the configured
round count.

The participant roster is fixed when the game starts. If a player disconnects
or leaves, they are removed from room membership by the room manager but are
not silently removed from an in-progress game's submission, voting, or
continuation quorum. The round therefore waits for all original participants;
this phase does not add reconnect identity or mid-round forfeits. If all room
members leave, the existing room cleanup removes the game session as well.

After final results, the room remains in its in-game state until the host
returns it to the lobby. The server retires the finished session, resets every
remaining member's ready state, and preserves the room code, host, membership,
and selected game. Starting again creates a new generic session and initializes
new fake-answer state, including fresh scores and a fresh round ID. Each generic
session has an opaque session ID so clients can ignore delayed state updates
from a retired session.
