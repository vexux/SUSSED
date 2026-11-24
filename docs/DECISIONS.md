# Engineering decisions

These entries record constraints visible in the implementation. Historical rationale is unconfirmed.

| Implemented decision | Consequence for changes | Evidence |
| --- | --- | --- |
| The server owns rooms and game sessions. | Validate actions before mutating state and derive client projections from the accepted state. | [Rooms](../server/roomManager.js), [sessions](../server/gameManager.js) |
| Multiplayer identity and account identity are separate. | Preserve a seat across socket changes and authorize account operations with verified account metadata. | [Guest identities](../server/guestIdentityManager.js), [account verification](../server/auth.js) |
| Live state is process-local, with one backend process assumed for a shared room population. | Restart loses matches. Independent instances cannot resume each other's rooms. | [Rooms](../server/roomManager.js), [deployment](../DEPLOYMENT.md) |
| The platform caps rooms at eight seats. | Apply a stricter game-specific maximum if declared. Keep the lobby and listings consistent with admission. | [Capacity](../server/roomConfiguration.js), [room manager](../server/roomManager.js) |
| Game registration separates engine hooks, protocol and catalogue policy. | Variants can reuse an engine protocol while exposing distinct IDs and question banks. | [Registry](../server/gameRegistry.js), [protocol mapping](../server/gameProtocols.js), [library](../server/gameLibrary.js) |
