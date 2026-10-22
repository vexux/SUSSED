import type { AppState, PublicRoom } from "./appState";

export function isPublicRoomJoinable(
  rooms: PublicRoom[],
  roomId: string,
): boolean {
  const room = rooms.find(({ roomId: candidateId }) => candidateId === roomId);
  return room !== undefined && room.playerCount < room.maxPlayers;
}

export function reconcilePublicRooms(
  state: AppState,
  rooms: PublicRoom[],
): boolean {
  state.publicRooms = rooms;
  const pendingRoomId = state.pendingPublicRoomId;
  if (!pendingRoomId || isPublicRoomJoinable(rooms, pendingRoomId)) {
    return false;
  }

  state.pendingPublicRoomId = null;
  state.nameEntryError = null;
  state.publicRoomsError =
    "That room is no longer available. Refresh the list or choose another room.";
  return true;
}
