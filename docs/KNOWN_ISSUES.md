# Known issues and limitations

## Accepted beta limitations

The [decision register](DECISIONS.md) records the approval and review triggers for these limits.

| Decision | Operational consequence |
| --- | --- |
| 6. Restart ends active sessions | A backend restart loses live rooms, recovery reservations and results still being viewed. A client credential cannot restore them on a fresh process. [Room manager](../server/roomManager.js) |
| 7. Moderation records are temporary | Restart clears reports and review decisions. Queue operations also prune records aged seven days from creation, so even an uninterrupted process offers limited review history. [Moderation](../server/moderation.js) |
| 8. Chat follows room lifetime | History is paged on read. A room can accumulate messages throughout its lifetime without a fixed age or count limit. [Chat manager](../server/roomChatManager.js) |

## Risks requiring investigation

| Open question or coverage gap | Proposed check |
| --- | --- |
| How much memory does a long-lived room consume? | Measure retained memory against message volume, reactions and retries, including after room destruction. |
| What does a player see when a backend restart destroys their session? | Restart a local backend during play. Verify that the client clearly communicates the ended session and lets the player create or join another room. Compare with an ordinary reconnect while the server remains running. |
| Does every room destruction path release associated chat state? | Trace each path to the cleanup hook and check message history, reactions and retry receipts. The manager stores reactions in a message-keyed WeakMap, so check whether any message references remain. [Room handlers](../server/roomHandlers.js), [chat manager](../server/roomChatManager.js) |
| CI runs Node client tests and server socket tests. The multi-browser room, play and refresh journey is a manual smoke test. [CI](../.github/workflows/ci.yml), [manual checks](../DEPLOYMENT.md) | Automate a two-browser journey against the running client and server. |

## Resolved documentation inconsistencies

The [Fact or Cap guide](../server/games/fact-or-cap/README.md) now reflects the eight-seat room limit. The [deployment guide](../DEPLOYMENT.md) now describes Supabase use for social data as well as profiles.
