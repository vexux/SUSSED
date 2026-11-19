# Room discovery and visibility protocol

The server remains authoritative for room visibility, capacity, and join eligibility. Room state is in memory; reconnecting or restarting the server does not persist rooms.

## Socket authentication

- Socket.IO clients may connect without an access token and continue to play as guests.
- Authenticated clients provide `{ accessToken }` in the Socket.IO connection `auth` payload. The server verifies the Firebase ID token with Firebase Admin before accepting the connection.
- Invalid, expired, or unverifiable supplied tokens are rejected; they are never downgraded to guest connections. If Firebase Admin configuration is absent, guests remain allowed but supplied tokens are rejected.
- After successful verification, the server stores the Firebase UID in `socket.data.accountId`. Account identity remains separate from the server-issued multiplayer player identity in `socket.data.playerId`.

## Guest player identity and recovery

- Every accepted Socket.IO connection receives a server-generated UUID player ID. The transport `socket.id` is used only for Socket.IO transport and active-socket bookkeeping; it is not used as a room or game player ID.
- The server issues a 256-bit random recovery credential. The browser stores it only in tab-scoped `sessionStorage`, under the `sussed:guest-recovery:v1` key. A temporary pending key supports credential rotation.
- The server stores only a SHA-256 hash of each active credential. Credentials are rotated when a guest recovers an identity, and a previously rotated credential is rejected as replayed.
- The server sends `guest-session-issued` with `{ playerId, recoveryCredential, rotated }`. The client first stages the credential, then acknowledges `{ stored: true }`; the server responds with `guest-session-ready` only after activation. Room/game and account handlers are unavailable before that acknowledgement.
- Invalid, expired, or replayed credentials are rejected with `INVALID_RECOVERY_CREDENTIAL` or `RECOVERY_REPLAYED`. Concurrent recovery is rejected with `RECOVERY_IN_PROGRESS`, and a credential cannot take over an identity that still has an active socket (`PLAYER_ALREADY_CONNECTED`).
- If storage is unavailable, the client rejects the issuance; if the acknowledgement times out, the server rejects the session. In either case, room/game handlers are not registered.
- Recovery credentials expire 30 days after issuance or rotation. Recovery is kept in memory on the server and is not preserved through a server restart. If a credential is rejected as expired or unknown, the client clears it and starts a new guest identity.
- An unexpected socket disconnect starts a server-controlled 90-second grace period. The player remains in the room and match roster during that interval; their seat, display name, score, and round history are retained, and public room occupancy includes the reserved seat. Lobby and game projections mark the player with `connected: false`; connected players omit that property. The server immediately suspends the player from current-round action eligibility. Already-submitted answers and votes remain recorded, while unfinished actions no longer block the connected players' phase progression.
- Reconnecting with the same recovery credential before the grace period expires cancels the matching timer, restores the existing room/game membership, and returns a per-viewer snapshot. The player is a spectator for the remainder of the current round, including if they reconnect during results; server-side authorization rejects submissions, votes, and continuation actions. They become eligible again when the next question opens if they are still connected. A reconnect during the final round remains spectator-only through the final results. Timers are bound to the exact room instance and guarded against stale disconnect/reconnect events.
- If the 90-second period expires, the server permanently removes the player through the existing departure cleanup exactly once. Host transfer, room capacity release, and game participant reconciliation happen at that time; late recovery cannot restore the departed room or match membership. Explicitly leaving or being kicked remains an immediate permanent departure and never enters the spectator-rejoin flow.
- Only an activated recovery connection cancels grace. If expiry and an unacknowledged recovery race, whichever server-side operation runs first determines whether the old room membership remains; even after expiry, the guest credential can recover the same identity and join another room.
- Rooms and grace timers remain in memory. Server restart clears both, and this protocol adds no persistent room/game restoration or database state.
- Explicit leave and kick immediately remove that player's membership and matching grace timer; destroying a room also cancels timers for that exact room instance. Neither operation invalidates the recovery credential. The player can use the same identity to join another room in the same browser tab; restoration reports `no-room` for the departed room.
- Guest identities are independent of authenticated account IDs. This phase does not link guest identities to accounts or persist player identity in a database.
- Every client event packet is gated by both session activation and the identity manager's current active-socket mapping. A disconnected or superseded socket cannot use previously registered room/game handlers. Game actions also verify authoritative room and match membership, connected status, current-round eligibility, phase, and duplicate-action rules; client-supplied spectator or participant status is never trusted.

## Same-tab refresh restoration

- After `guest-session-ready`, the client emits `restore-session` with no payload. Room membership is resolved exclusively from the active server-side player identity; the client cannot select a room or supply a player ID.
- The acknowledgement is `{ status: "no-room", playerId }` when the identity has no current room, or `{ status: "restored", playerId, snapshot: { playerId, lobby, game } }` when it does. Invalid payloads and unavailable/inconsistent snapshots return structured errors.
- The lobby is the current authoritative room projection. During a starting/active game, `game` is the current per-viewer public projection. For a player still viewing results after the host returned to the lobby, `game` is the finished match snapshot authorized for that results viewer. Ordinary lobby players receive `game: null`.
- Game projections are explicit for the requesting player. During submission, only that player's own submitted answer is included; voting projections include the options already allowed in that phase and only that player's own vote choice. Reveal/results expose only the phase's established public content. Answer authors, other players' submission text before reveal, other players' vote choices, credentials, hashes, timers, and internal implementation objects are not included.
- Room and game revisions increase on their respective state mutations. The client keeps the highest room revision and, within the snapshot's exact game session, the highest game revision. A buffered event from another game session cannot replace the authoritative snapshot. Socket.IO preserves outbound event order on a connection: events delivered before the restoration acknowledgement are reconciled against the snapshot, and later events continue through the normal live handlers.
- Repeated restoration requests do not create or start another room or game. Snapshot generation only projects current state. The server verifies the active identity before joining the room and again after the asynchronous room join, before generating the snapshot.
- The client buffers room/game events while the restored snapshot is pending, then resumes the appropriate lobby, starting, active-game, or results view. A temporary request failure preserves the recovery credential and offers retry; an authoritative `no-room` response returns to room entry without deleting the guest identity.
- Restoration is available only while the matching guest identity and room/game state remain in server memory. It does not survive a server restart or deployment, and it does not share credentials across tabs.

## Account profiles

- `get-profile` creates a missing profile for the verified `socket.data.accountId` and returns `{ profile }`. It is available only to authenticated sockets.
- `update-profile-display-name` accepts `{ displayName }` and updates only the calling socket's verified account profile. A client-supplied UID is ignored.
- Profile operations use the server-only Supabase service-role client. If database configuration or access is unavailable, the event returns a controlled `PROFILE_UNAVAILABLE` error. These events are separate from room creation, joining, and gameplay.
- Guests receive `AUTH_REQUIRED` for profile requests and never create persistent profile records. Profile IDs are Firebase UIDs stored as text and are distinct from socket IDs and multiplayer player IDs.

## Capacity

`roomConfiguration.js` defines the shared maximum of eight players. A game's own maximum, if configured, is applied as a stricter limit. The server includes the effective `maxPlayers` in the game list, lobby state, and public-room entries. Both join paths synchronously validate and insert the player before the handler awaits Socket.IO membership, reserving the slot against concurrent joins.

## Room visibility

- `create-room` accepts `{ playerName, gameId, visibility }`. `visibility` is `public` or `private`; omission defaults to `private` for older clients.
- `set-room-visibility` accepts `{ visibility }` and acknowledges `{ visibility, lobby }`. Only the host can change it, and only while the room is in the lobby.
- Lobby state includes `visibility` and effective `maxPlayers`.

## Public room browser

- `subscribe-public-rooms` joins the requesting socket to the live browser feed and acknowledges `{ rooms }`.
- `refresh-public-rooms` acknowledges a current `{ rooms }` snapshot without changing subscription state.
- Subscribers receive `public-rooms-updated` with `{ rooms }` after relevant room changes.
- `unsubscribe-public-rooms` leaves the feed.
- Each room entry contains only `{ roomId, hostName, gameId, gameName, gameDescription, playerCount, maxPlayers, status }`. `hostName` is the current host's validated display name. `roomId` is an opaque reference distinct from the join-by-code room code; no room code or player list or private player details are included. Entries are sorted by descending occupancy ratio, then descending player count, then ascending opaque room ID.
- `join-public-room` accepts `{ publicRoomId, playerName }` and acknowledges `{ lobby }` on success. The server rechecks that the referenced room is public, in the lobby, and has capacity at the instant the slot is reserved. Stale, private, started, full, or removed rooms return structured errors.

The existing `join-room` `{ roomCode, playerName }` flow remains available for private rooms and also enforces capacity. Public listings are filtered by the server to rooms that are public, in the lobby, and below their effective capacity.

## Host removal

- `transfer-host` accepts `{ targetPlayerId }` and acknowledges `{ transferred, playerId, lobby }` on success.
- Only the current room host may transfer host status to a different connected member while the room is in the lobby. Invalid, self-targeted, stale, disconnected, cross-room, non-host, and out-of-lobby requests return structured errors without changing room state.
- A successful transfer changes only the authoritative `hostId` and room revision. The former host remains in the room as a regular player. The server broadcasts the projected `lobby-state` to every current room member, and subsequent host-only actions use the new host identity. This operation does not run departure reconciliation.
- `kick-player` accepts `{ targetPlayerId }` and acknowledges `{ kicked, playerId }` on success.
- Only the current host can remove another player, and only while the room is in the lobby. Self-removal, non-host requests, stale targets, and malformed payloads return structured errors without changing membership.
- The removed socket receives `removed-from-room` with `{ roomCode, reason: "kicked", message }`, then leaves the Socket.IO room. The server reconciles the removal through the same departure path used by leave/disconnect, so room state and public listings update together. Removed sockets no longer pass the room-membership checks used by game actions.
- Kicked players are not persistently banned and may join again if normal room rules permit.

## Invitations

Invitations are frontend links to the existing single-page entry URL, in the form `/?code=ZING`. `code` is URL-encoded and contains only the room code. On page load, the client accepts one four-letter code and prefills the normal room-code field; it never joins automatically. The ordinary name and server-side join validation still apply. A malformed or duplicate code query is shown as an actionable error.

Set `VITE_PUBLIC_APP_URL` to the public frontend origin for invitation generation when a canonical deployment origin is configured. If unset, the client uses the current page origin, which keeps Vercel preview deployments and local development on their own host. This does not affect `VITE_SERVER_URL` or backend CORS configuration.
