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
