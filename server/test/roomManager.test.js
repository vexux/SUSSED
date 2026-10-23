const assert = require("node:assert/strict");
const test = require("node:test");
const roomManager = require("../roomManager");
const gameRegistry = require("../gameRegistry");

const ROOM_CODE_PATTERN = /^[A-Z]{4}$/;

test("creates rooms with unique codes and the creator as host and first player", (context) => {
    const rooms = [];

    context.after(() => {
        for (const room of rooms) {
            roomManager.removeRoom(room.code);
        }
    });

    for (let index = 0; index < 50; index += 1) {
        rooms.push(roomManager.createRoom(`player-${index}`, `Player ${index}`));
    }

    assert.equal(
        new Set(rooms.map((room) => room.code)).size,
        rooms.length,
        "room codes should be unique"
    );

    for (let index = 0; index < rooms.length; index += 1) {
        const room = rooms[index];
        assert.match(room.code, ROOM_CODE_PATTERN);
        assert.equal(room.hostId, `player-${index}`);
        assert.deepEqual(room.players, [
            { id: `player-${index}`, name: `Player ${index}`, isReady: false, viewingResultsSessionId: null },
        ]);
    }
});

test("creates a room with a registered selected game and rejects unknown game IDs", (context) => {
    const room = roomManager.createRoom("selected-game-host", "Host", "fact-or-cap-anime");
    context.after(() => roomManager.removeRoom(room.code));
    assert.equal(room.selectedGameId, "fact-or-cap-anime");
    assert.throws(
        () => roomManager.createRoom("invalid-game-host", "Host", "not-a-game"),
        { code: "GAME_NOT_FOUND" }
    );
    assert.equal(roomManager.getPlayerRoom("invalid-game-host"), null);
});

test("changing the selected game is host-only and preserves lobby settings and player state", (context) => {
    const room = roomManager.createRoom("change-game-host", "Host", "fact-or-cap");
    context.after(() => roomManager.removeRoom(room.code));
    const guest = roomManager.joinRoom(room.code, "change-game-guest", "Guest");
    roomManager.setRoomVisibility(room.hostId, "public");
    roomManager.selectRoundCount(room.hostId, 7, room.revision);
    roomManager.setPlayerReady(guest.players[1].id, true);

    const previousCode = room.code;
    const previousHostId = room.hostId;
    const previousPlayers = room.players.map((player) => ({ ...player }));
    const previousRevision = room.revision;
    const changed = roomManager.selectGame(room.hostId, "bruh-wtf");

    assert.equal(changed, room);
    assert.equal(room.selectedGameId, "bruh-wtf");
    assert.equal(room.code, previousCode);
    assert.equal(room.hostId, previousHostId);
    assert.equal(room.visibility, "public");
    assert.equal(room.selectedRoundCount, 7);
    assert.deepEqual(room.players, previousPlayers);
    assert.ok(room.revision > previousRevision);
    const lobby = roomManager.createLobbyState(room);
    assert.equal(lobby.selectedGame.displayName, "Bruh wtf?");
    assert.equal(lobby.selectedGame.supportsRoundSelection, true);
    assert.throws(
        () => roomManager.selectGame(guest.players[1].id, "fact-or-cap"),
        { code: "NOT_HOST" }
    );
    assert.equal(room.selectedGameId, "bruh-wtf");

    room.status = "starting";
    assert.throws(
        () => roomManager.selectGame(room.hostId, "fact-or-cap"),
        { code: "ROOM_NOT_IN_LOBBY" }
    );
    assert.equal(room.selectedGameId, "bruh-wtf");
});

test("room-code pool is unique, four letters, and reports exhaustion without replacing rooms", (context) => {
    const rooms = [];
    context.after(() => {
        for (const room of rooms) {
            roomManager.removeRoom(room.code);
        }
    });

    for (let index = 0; index < roomManager.ROOM_CODE_COUNT; index += 1) {
        rooms.push(roomManager.createRoom(`pool-player-${index}`, `Player ${index}`));
    }
    const originalRooms = rooms.map((room) => roomManager.getRoom(room.code));

    assert.equal(new Set(rooms.map(({ code }) => code)).size, roomManager.ROOM_CODE_COUNT);
    assert.ok(rooms.every(({ code }) => ROOM_CODE_PATTERN.test(code)));
    assert.throws(
        () => roomManager.createRoom("pool-exhausted", "No Code"),
        { code: "NO_ROOM_CODES" }
    );
    assert.deepEqual(
        rooms.map((room) => roomManager.getRoom(room.code)),
        originalRooms
    );
});

test("synchronous concurrent room creation never reuses a code or overwrites a room", async (context) => {
    const rooms = await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
            Promise.resolve().then(() =>
                roomManager.createRoom(`parallel-${index}`, `Player ${index}`)
            )
        )
    );
    context.after(() => {
        for (const room of rooms) {
            roomManager.removeRoom(room.code);
        }
    });

    assert.equal(new Set(rooms.map(({ code }) => code)).size, rooms.length);
    for (const [index, room] of rooms.entries()) {
        assert.match(room.code, ROOM_CODE_PATTERN);
        assert.equal(room.hostId, `parallel-${index}`);
        assert.equal(roomManager.getRoom(room.code), room);
    }
});

test("room codes normalize to uppercase for lookup and joining", (context) => {
    const host = roomManager.createRoom("case-host", "Host");
    context.after(() => roomManager.removeRoom(host.code));

    const guest = roomManager.joinRoom(host.code.toLowerCase(), "case-guest", "Guest");
    assert.equal(guest.code, host.code);
    assert.equal(roomManager.getRoom(host.code.toLowerCase()), host);
    assert.equal(host.players.length, 2);
});

test("rooms start with five rounds and enforce the shared eight-player capacity", (context) => {
    const host = roomManager.createRoom("capped-host", "Host");
    context.after(() => roomManager.removeRoom(host.code));
    assert.equal(host.selectedRoundCount, 5);
    assert.equal(roomManager.createLobbyState(host).selectedRoundCount, 5);
    assert.equal(roomManager.MAX_ROOM_CAPACITY, 8);
    assert.equal(roomManager.createLobbyState(host).maxPlayers, roomManager.MAX_ROOM_CAPACITY);

    for (let index = 1; index < roomManager.MAX_ROOM_CAPACITY; index += 1) {
        roomManager.joinRoom(host.code, `capped-${index}`, `Player ${index}`);
    }
    assert.equal(host.players.length, roomManager.MAX_ROOM_CAPACITY);
    assert.throws(
        () => roomManager.joinRoom(host.code, "ninth-player", "Ninth"),
        { code: "ROOM_FULL" }
    );
    assert.equal(host.players.length, roomManager.MAX_ROOM_CAPACITY);
});

test("simultaneous joins reserve only the last available room slot", async (context) => {
    const host = roomManager.createRoom("last-slot-host", "Host");
    context.after(() => roomManager.removeRoom(host.code));
    for (let index = 1; index < roomManager.MAX_ROOM_CAPACITY - 1; index += 1) {
        roomManager.joinRoom(host.code, `last-slot-${index}`, `Player ${index}`);
    }

    const attempts = await Promise.allSettled([
        Promise.resolve().then(() => roomManager.joinRoom(host.code, "last-slot-a", "Player A")),
        Promise.resolve().then(() => roomManager.joinRoom(host.code, "last-slot-b", "Player B")),
    ]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(attempts.filter(({ status, reason }) => status === "rejected" && reason.code === "ROOM_FULL").length, 1);
    assert.equal(host.players.length, roomManager.MAX_ROOM_CAPACITY);
});

test("simultaneous public joins cannot exceed room capacity", async (context) => {
    const host = roomManager.createRoom("public-last-slot-host", "Host", undefined, "public");
    context.after(() => roomManager.removeRoom(host.code));
    for (let index = 1; index < roomManager.MAX_ROOM_CAPACITY - 1; index += 1) {
        roomManager.joinRoom(host.code, `public-last-slot-${index}`, `Player ${index}`);
    }
    const roomId = roomManager.listPublicRooms()[0].roomId;
    const attempts = await Promise.allSettled([
        Promise.resolve().then(() => roomManager.joinPublicRoom(roomId, "public-last-slot-a", "Player A")),
        Promise.resolve().then(() => roomManager.joinPublicRoom(roomId, "public-last-slot-b", "Player B")),
    ]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(attempts.filter(({ status, reason }) => status === "rejected" && reason.code === "ROOM_FULL").length, 1);
    assert.equal(host.players.length, roomManager.MAX_ROOM_CAPACITY);
});

test("visibility defaults to private and only the host can change it in the lobby", (context) => {
    const room = roomManager.createRoom("visibility-host", "Host");
    context.after(() => roomManager.removeRoom(room.code));
    const guest = roomManager.joinRoom(room.code, "visibility-guest", "Guest");
    assert.equal(room.visibility, "private");
    assert.equal(roomManager.listPublicRooms().some(({ roomId }) => roomId === room.publicRoomId), false);
    assert.throws(() => roomManager.createRoom("invalid-visibility", "Invalid", undefined, "unlisted"), { code: "INVALID_VISIBILITY" });
    assert.throws(() => roomManager.setRoomVisibility(guest.players[1].id, "public"), { code: "NOT_HOST" });
    assert.throws(() => roomManager.setRoomVisibility(room.hostId, "unlisted"), { code: "INVALID_VISIBILITY" });

    roomManager.setRoomVisibility(room.hostId, "public");
    assert.equal(roomManager.createLobbyState(room).visibility, "public");
    assert.equal(roomManager.listPublicRooms().some(({ roomId }) => roomId === room.publicRoomId), true);
    roomManager.setRoomVisibility(room.hostId, "private");
    assert.equal(roomManager.listPublicRooms().some(({ roomId }) => roomId === room.publicRoomId), false);

    room.visibility = "public";
    room.status = "starting";
    assert.throws(() => roomManager.setRoomVisibility(room.hostId, "private"), { code: "ROOM_NOT_IN_LOBBY" });
});

test("kick validation is host-only, lobby-only, rejects self and safely handles stale targets", (context) => {
    const room = roomManager.createRoom("kick-host", "Host");
    context.after(() => roomManager.removeRoom(room.code));
    roomManager.joinRoom(room.code, "kick-guest", "Guest");

    assert.equal(roomManager.validatePlayerKick("kick-host", "kick-guest").target.name, "Guest");
    assert.throws(() => roomManager.validatePlayerKick("kick-guest", "kick-host"), { code: "NOT_HOST" });
    assert.throws(() => roomManager.validatePlayerKick("kick-host", "kick-host"), { code: "CANNOT_KICK_SELF" });
    assert.throws(() => roomManager.validatePlayerKick("kick-host", "stale-player"), { code: "TARGET_NOT_FOUND" });

    roomManager.removePlayer("kick-guest");
    assert.throws(() => roomManager.validatePlayerKick("kick-host", "kick-guest"), { code: "TARGET_NOT_FOUND" });
    roomManager.joinRoom(room.code, "kick-guest-2", "Guest Two");
    room.status = "starting";
    assert.throws(() => roomManager.validatePlayerKick("kick-host", "kick-guest-2"), { code: "ROOM_NOT_IN_LOBBY" });
});

test("host transfer is atomic, lobby-only, and preserves all other room and player state", (context) => {
    const room = roomManager.createRoom("transfer-host", "Host");
    context.after(() => roomManager.removeRoom(room.code));
    roomManager.joinRoom(room.code, "transfer-guest", "Guest");
    roomManager.joinRoom(room.code, "transfer-other", "Other");
    roomManager.setRoomVisibility(room.hostId, "public");
    roomManager.selectRoundCount(room.hostId, 7, room.revision);
    roomManager.setPlayerReady("transfer-guest", true);
    const previousHost = room.hostId;
    const target = "transfer-guest";
    const snapshot = {
        code: room.code,
        visibility: room.visibility,
        selectedGameId: room.selectedGameId,
        selectedRoundCount: room.selectedRoundCount,
        players: room.players.map((player) => ({ ...player }))
    };

    assert.throws(() => roomManager.transferHost(target, previousHost), { code: "NOT_HOST" });
    assert.throws(() => roomManager.transferHost(previousHost, previousHost), { code: "CANNOT_TRANSFER_HOST_TO_SELF" });
    assert.throws(() => roomManager.transferHost(previousHost, "not-a-member"), { code: "TARGET_NOT_FOUND" });
    assert.throws(() => roomManager.transferHost(previousHost, ""), { code: "INVALID_PLAYER" });
    assert.equal(room.hostId, previousHost);

    const revision = room.revision;
    assert.equal(roomManager.transferHost(previousHost, target), room);
    assert.equal(room.hostId, target);
    assert.ok(room.revision > revision);
    assert.deepEqual({
        code: room.code,
        visibility: room.visibility,
        selectedGameId: room.selectedGameId,
        selectedRoundCount: room.selectedRoundCount,
        players: room.players
    }, snapshot);
    const lobby = roomManager.createLobbyState(room);
    assert.equal(lobby.players.find(({ id }) => id === previousHost).isHost, false);
    assert.equal(lobby.players.find(({ id }) => id === target).isHost, true);
    room.status = "starting";
    assert.throws(() => roomManager.transferHost(target, "transfer-other"), { code: "ROOM_NOT_IN_LOBBY" });
    assert.equal(room.hostId, target);
});

test("public discovery exposes opaque references only and public joins revalidate visibility and capacity", (context) => {
    const room = roomManager.createRoom("public-host", "Secret Host", undefined, "public");
    context.after(() => roomManager.removeRoom(room.code));
    let listing = roomManager.listPublicRooms();
    assert.equal(listing.length, 1);
    assert.deepEqual(Object.keys(listing[0]).sort(), [
        "gameDescription", "gameId", "gameName", "hostName", "maxPlayers", "playerCount", "roomId", "status",
    ]);
    assert.equal(listing[0].hostName, "Secret Host");
    assert.equal(JSON.stringify(listing).includes(room.code), false);
    const publicJoin = roomManager.joinPublicRoom(listing[0].roomId, "public-guest", "Guest");
    assert.equal(publicJoin.players.length, 2);
    assert.throws(() => roomManager.joinPublicRoom("stale-public-id", "stale-guest", "Stale"), { code: "PUBLIC_ROOM_NOT_FOUND" });

    roomManager.setRoomVisibility(room.hostId, "private");
    assert.throws(() => roomManager.joinPublicRoom(room.publicRoomId, "late-guest", "Late"), { code: "ROOM_NOT_PUBLIC" });
});

test("public listings use the current host and sort by occupancy ratio with deterministic ties", (context) => {
    const originalGet = gameRegistry.get;
    const rooms = [];
    gameRegistry.get = (gameId) => {
        const game = originalGet(gameId);
        if (!game) return game;
        return {
            ...game,
            supportedPlayers: {
                ...game.supportedPlayers,
                max: gameId === "bruh-wtf" ? 4 : 8
            }
        };
    };
    context.after(() => {
        gameRegistry.get = originalGet;
        for (const room of rooms) roomManager.removeRoom(room.code);
    });

    const standardRoom = roomManager.createRoom("sort-standard-host", "Alpha", "fact-or-cap", "public");
    const smallRoom = roomManager.createRoom("sort-small-host", "Beta", "bruh-wtf", "public");
    const standardTieRoom = roomManager.createRoom("sort-tie-host", "Charlie", "fact-or-cap", "public");
    const fullerRoom = roomManager.createRoom("sort-fuller-host", "Delta", "fact-or-cap", "public");
    rooms.push(standardRoom, smallRoom, standardTieRoom, fullerRoom);

    for (let index = 1; index < 4; index += 1) {
        roomManager.joinRoom(standardRoom.code, `sort-standard-${index}`, `Standard ${index}`);
        roomManager.joinRoom(standardTieRoom.code, `sort-tie-${index}`, `Tie ${index}`);
    }
    roomManager.joinRoom(smallRoom.code, "sort-small-1", "Small 1");
    roomManager.joinRoom(fullerRoom.code, "sort-fuller-1", "Fuller 1");
    roomManager.joinRoom(fullerRoom.code, "sort-fuller-2", "Fuller 2");
    roomManager.joinRoom(fullerRoom.code, "sort-fuller-3", "Fuller 3");
    roomManager.joinRoom(fullerRoom.code, "sort-fuller-4", "Fuller 4");
    roomManager.transferHost(standardRoom.hostId, "sort-standard-1");

    const listing = roomManager.listPublicRooms();
    assert.deepEqual(listing.map(({ roomId }) => roomId), [
        fullerRoom.publicRoomId,
        ...[standardRoom, standardTieRoom].map(({ publicRoomId }) => publicRoomId).sort(),
        smallRoom.publicRoomId,
    ]);
    assert.equal(listing.find(({ roomId }) => roomId === standardRoom.publicRoomId).hostName, "Standard 1");
    assert.equal(listing.find(({ roomId }) => roomId === smallRoom.publicRoomId).maxPlayers, 4);
    assert.equal(listing.some(({ roomId }) => roomId === fullerRoom.publicRoomId), true);
});

test("round count changes require an eligible host and a current lobby revision", (context) => {
    const host = roomManager.createRoom("round-host", "Host");
    context.after(() => roomManager.removeRoom(host.code));
    const guest = roomManager.joinRoom(host.code, "round-guest", "Guest");

    for (const roundCount of [7, 10, 5]) {
        roomManager.selectRoundCount(host.hostId, roundCount, host.revision);
        assert.equal(host.selectedRoundCount, roundCount);
    }
    assert.throws(
        () => roomManager.selectRoundCount(guest.players[1].id, 7, host.revision),
        { code: "NOT_HOST" }
    );
    assert.throws(
        () => roomManager.selectRoundCount(host.hostId, 6, host.revision),
        { code: "INVALID_ROUND_COUNT" }
    );
    assert.throws(
        () => roomManager.selectRoundCount(host.hostId, 7, host.revision - 1),
        { code: "STALE_ROOM_STATE" }
    );

    roomManager.removePlayer(host.hostId);
    roomManager.selectRoundCount(guest.players[0].id, 7, guest.revision);
    assert.equal(guest.selectedRoundCount, 7);
});

test("player names are unique within one room after trimming and case normalization", (context) => {
    const room = roomManager.createRoom("unique-host", "Alex");
    context.after(() => roomManager.removeRoom(room.code));

    for (const name of ["alex", " Alex ", "ALEX"]) {
        assert.throws(
            () => roomManager.joinRoom(room.code, `duplicate-${name}`, name),
            {
                code: "DUPLICATE_PLAYER_NAME",
                message: "That name is already used in this room. Choose another name."
            }
        );
    }
    assert.equal(room.players.length, 1);
});

test("identical names are allowed in separate rooms and become reusable after removal", (context) => {
    const firstRoom = roomManager.createRoom("name-room-host-1", "Alex");
    const secondRoom = roomManager.createRoom("name-room-host-2", "alex");
    context.after(() => {
        roomManager.removeRoom(firstRoom.code);
        roomManager.removeRoom(secondRoom.code);
    });

    const guest = roomManager.joinRoom(firstRoom.code, "name-room-guest", "Guest");
    roomManager.removePlayer("name-room-guest");
    const replacement = roomManager.joinRoom(firstRoom.code, "name-room-replacement", " guest ");
    assert.equal(replacement.players.length, 2);
    assert.equal(replacement.players[1].name, "guest");
    assert.equal(secondRoom.players[0].name, "alex");
    assert.equal(guest.code, firstRoom.code);
});

test("simultaneous equivalent-name joins can only insert one player", async (context) => {
    const room = roomManager.createRoom("atomic-name-host", "Host");
    context.after(() => roomManager.removeRoom(room.code));

    const attempts = await Promise.allSettled([
        Promise.resolve().then(() => roomManager.joinRoom(room.code, "atomic-name-1", "Shared")),
        Promise.resolve().then(() => roomManager.joinRoom(room.code, "atomic-name-2", " shared ")),
    ]);
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = attempts.find(({ status }) => status === "rejected");
    assert.equal(rejected.reason.code, "DUPLICATE_PLAYER_NAME");
    assert.equal(room.players.length, 2);
});
