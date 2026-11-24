# Known issues and limitations

| Confirmed behaviour or coverage gap | Possible follow-up (proposed) |
| --- | --- |
| A backend restart loses live rooms, recovery reservations and results still being viewed. The client credential cannot restore them on a fresh process. [Room manager](../server/roomManager.js) | Decide whether planned restarts should drain rooms or whether matches need durable recovery. |
| Reports and review decisions share a process-local store. Restart clears it. Queue operations prune records aged seven days from creation. [Moderation](../server/moderation.js) | Agree on review and retention requirements before introducing durable storage. |
| Chat history is paged on read, but messages can accumulate throughout a room's lifetime without a total-history cap. [Chat manager](../server/roomChatManager.js) | Choose a retention limit and define what pagination returns when older messages expire. |
| CI runs Node client tests and server socket tests. The multi-browser room, play and refresh journey is a manual smoke test. [CI](../.github/workflows/ci.yml), [manual checks](../DEPLOYMENT.md) | Automate a two-browser journey against the running client and server. |

## Resolved documentation inconsistencies

The [Fact or Cap guide](../server/games/fact-or-cap/README.md) now reflects the eight-seat room limit. The [deployment guide](../DEPLOYMENT.md) now describes Supabase use for social data as well as profiles.
