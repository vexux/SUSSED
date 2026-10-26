# Room discovery and visibility protocol

The server remains authoritative for room visibility, capacity, and join eligibility. Room state is in memory; reconnecting or restarting the server does not persist rooms.

## Socket authentication

- Socket.IO clients may connect without an access token and continue to play as guests.
- Authenticated clients provide `{ accessToken }` in the Socket.IO connection `auth` payload. The server verifies the Firebase ID token with Firebase Admin before accepting the connection.
- Invalid, expired, or unverifiable supplied tokens are rejected; they are never downgraded to guest connections. If Firebase Admin configuration is absent, guests remain allowed but supplied tokens are rejected.
- After successful verification, the server stores the Firebase UID in `socket.data.accountId`. This metadata does not replace or affect `socket.id`, which remains the room/player identity.

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
