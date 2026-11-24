# Engineering decisions

The first five entries record constraints visible in the implementation. Their historical rationale is unconfirmed.

| Implemented decision | Consequence for changes | Evidence |
| --- | --- | --- |
| The server owns rooms and game sessions. | Validate actions before mutating state and derive client projections from the accepted state. | [Rooms](../server/roomManager.js), [sessions](../server/gameManager.js) |
| Multiplayer identity and account identity are separate. | Preserve a seat across socket changes and authorize account operations with verified account metadata. | [Guest identities](../server/guestIdentityManager.js), [account verification](../server/auth.js) |
| Live state is process-local, with one backend process assumed for a shared room population. | Restart loses matches. Independent instances cannot resume each other's rooms. | [Rooms](../server/roomManager.js), [deployment](../DEPLOYMENT.md) |
| The platform caps rooms at eight seats. | Apply a stricter game-specific maximum if declared. Keep the lobby and listings consistent with admission. | [Capacity](../server/roomConfiguration.js), [room manager](../server/roomManager.js) |
| Game registration separates engine hooks, protocol and catalogue policy. | Variants can reuse an engine protocol while exposing distinct IDs and question banks. | [Registry](../server/gameRegistry.js), [protocol mapping](../server/gameProtocols.js), [library](../server/gameLibrary.js) |

## Approved beta decisions

Decisions 6–8 were approved on 24 November 2026. Expected behaviour records the product requirement. Outstanding verification is tracked in [Known issues](KNOWN_ISSUES.md).

| Decision | Approved rationale and expected behaviour | Trade-off and review trigger |
| --- | --- | --- |
| **6. Backend restart ends active sessions** | Rooms, games, guest identities, chat and recovery state live in memory. Durable multiplayer recovery would add infrastructure and complexity beyond current beta needs. Ordinary player disconnects still use reconnect handling. Process replacement ends the session. When restoration is impossible, players should see that the session ended and be able to create or join another room. | A restart can erase an unfinished match and its guest recovery state. Revisit if uninterrupted sessions become a requirement or restart losses become unacceptable in beta. |
| **7. Moderation records remain in memory during beta** | Keeping reports and review decisions process-local simplifies beta operations and avoids another storage dependency. Reporting and review remain available. Operator guidance and product messaging must treat these records as temporary. | A restart can erase pending reports and past decisions. Operators cannot rely on the queue for a durable audit history. Revisit as public access expands, disputes become more frequent or durable abuse-report history becomes necessary. |
| **8. Room chat history lasts for the room lifetime** | Players should retain the conversation while their room exists, without a fixed message count or age limit. Existing room destruction is the cleanup boundary for messages, reactions and retry state. | Long-lived or busy rooms can consume more memory. Revisit if measurements show meaningful pressure, long-lived rooms become common or retention requirements tighten. |

## Decision review

Revisit an approved beta decision when requirements change or evidence meets its review trigger. Record the evidence and the outcome of the review alongside the decision.
