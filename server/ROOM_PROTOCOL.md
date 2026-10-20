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
