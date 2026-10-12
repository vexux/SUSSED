# Bruh wtf? Batch 001 Playtest Run Sheet

This is a manual run sheet for collecting real player feedback on
`bruh-wtf-production-batch-001`. It is a blank template: no reactions or
playtest status are implied. Use one copy per session. The editorial scoring
rubric remains in [the batch audit](./bruh-wtf-production-batch-001.md).

## Session details

- Session ID: __________
- Date/time: __________
- Host/facilitator: __________
- Player count (3–8 total): __________
- Anonymous player labels (P1–P8): __________
- Devices/browsers: __________
- Build/commit under test: __________
- Selected game: Bruh wtf?; rounds: 5
- Technical observer (if different): __________

## Run checklist

- [ ] For a local run, execute `npm run dev` from the repository root. Open
  `http://localhost:5173` in separate browser profiles for each player; the
  default client connects to `http://localhost:3000`. For multi-device play,
  use the existing reachable staging setup or configure `VITE_SERVER_URL`
  to the reachable server before starting the Vite client. Confirm all
  participants can reach the client and server.
- [ ] The host creates a room and shares its room code with 2–7 additional
  players. Each additional player joins; check the displayed player count.
- [ ] In the lobby, select **Bruh wtf?** and **5 rounds**. Have players mark
  themselves Ready, then have the host select **Start game** when enabled.
- [ ] For each of the five rounds, record the displayed prompt's stable
  question ID in the feedback table. The ID is not shown in the game UI:
  match the prompt with player names substituted against the prompt template
  in `content/bruh-wtf-production-batch-001.json`. Record the round and
  player count as well.
- [ ] Each player enters and submits one answer. Wait for the submission
  progress to complete. Record confusion, inability to answer, and any
  technical issue. There is no skip button; record a verbal skip request,
  declined answer, or “would skip” reaction instead of asking players to
  work around the UI.
- [ ] In anonymous voting, each player selects another player's answer and
  submits a vote. Record whether the options are understandable, voting is
  engaging, and any player is reluctant to vote. Do not try to identify
  authors before results.
- [ ] At round results, check that answer authors and voters are revealed,
  each valid vote gives one point to the answer's author, and round and
  cumulative scores update. Record score discrepancies as technical issues.
- [ ] Every player selects **Continue**. Confirm the next round starts only
  after all players are ready. Repeat through round five.
- [ ] On final results, confirm the leaderboard and tied winners if
  applicable. Have the host select **Return to lobby** and confirm all
  players return to the same room.
- [ ] Complete the feedback table and separate technical issue log below.

Run multiple sessions with different groups when practical. A useful first
set is 3, 5, and 8 players; the three-player session can exercise prompts
targeting up to three named players, while larger sessions check the same
flow with a fuller lobby. Each session uses five rounds. Question selection
is randomized, so repeat sessions as needed to encounter more of the 25
prompts. Do not infer feedback for prompts a group did not see.

## Question-level feedback

Use one row for each prompt seen in this session; leave unseen IDs blank.
For **reactions**, enter counts such as `funny 3 / neutral 1 / not fun 1`,
using anonymous player labels for any useful comments. Rate clarity, answer
variety, and voting engagement with the same 0–2 anchors in the batch audit.
Record skip requests or answer struggles even though the game has no skip
control. Duplicate a row if a prompt appears more than once across sessions.

| Stable question ID | Round | Player reactions (funny/neutral/not fun) | Clarity 0–2 | Answer variety 0–2 | Voting engagement 0–2 | Skip/struggle count or intent | Anonymous notes / reason |
|---|---:|---|---:|---:|---:|---|---|
| `bruh-b001-warning-label` | | | | | | | |
| `bruh-b001-vending-advice` | | | | | | | |
| `bruh-b001-self-checkout-case` | | | | | | | |
| `bruh-b001-towel-exhibit` | | | | | | | |
| `bruh-b001-crossing-button` | | | | | | | |
| `bruh-b001-almost-worked-museum` | | | | | | | |
| `bruh-b001-basket-announcement` | | | | | | | |
| `bruh-b001-room-entry-rule` | | | | | | | |
| `bruh-b001-dragon-expense` | | | | | | | |
| `bruh-b001-object-spokesperson` | | | | | | | |
| `bruh-b001-office-supply-diner` | | | | | | | |
| `bruh-b001-goldfish-map-case` | | | | | | | |
| `bruh-b001-gnome-treaty` | | | | | | | |
| `bruh-b001-mystery-parcel` | | | | | | | |
| `bruh-b001-shared-coat` | | | | | | | |
| `bruh-b001-potato-float` | | | | | | | |
| `bruh-b001-elevator-anthem` | | | | | | | |
| `bruh-b001-tavern-soup` | | | | | | | |
| `bruh-b001-party-expertise` | | | | | | | |
| `bruh-b001-flatpack-cooking-show` | | | | | | | |
| `bruh-b001-reply-all-job` | | | | | | | |
| `bruh-b001-haunted-office-ghost-task` | | | | | | | |
| `bruh-b001-fridge-podcast` | | | | | | | |
| `bruh-b001-barely-prepared` | | | | | | | |
| `bruh-b001-terms-curse` | | | | | | | |

## Technical issue log

Keep technical issues separate from humour and clarity scores. Capture enough
detail to reproduce the issue; do not include private player answers unless
players consent to recording them.

| Issue ID | Session / round / question ID | Device and browser | What happened | Reproduction steps | Severity / follow-up |
|---|---|---|---|---|---|
| | | | | | |

## Session wrap-up

- Did all five rounds complete? __________
- Did scoring match one point per valid vote? __________
- Did return-to-lobby work for the host and other players? __________
- Prompts to keep, revise, or retire for follow-up (use existing rubric):
  __________
- Issues to reproduce separately from content feedback: __________
- Facilitator notes: __________

Do not mark any prompt playtested until an actual session has been completed
and its observations saved. A small number of sessions gives directional
feedback only, not statistically conclusive evidence.
