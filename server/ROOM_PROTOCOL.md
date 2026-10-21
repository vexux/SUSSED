# Room discovery and visibility protocol

The server remains authoritative for room visibility, capacity, and join eligibility. Room state is in memory; reconnecting or restarting the server does not persist rooms.

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
- Each room entry contains only `{ roomId, gameId, gameName, gameDescription, playerCount, maxPlayers, status }`. `roomId` is an opaque reference distinct from the join-by-code room code; no room code or player details are included.
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
