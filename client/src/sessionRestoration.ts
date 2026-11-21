import type { GameSessionState } from "./appState";

export function shouldClearGameOnLobbyUpdate(
  status: "lobby" | "starting",
  wasViewingArchive: boolean,
  isViewingArchive: boolean,
): boolean {
  return !isViewingArchive && (status === "lobby" || wasViewingArchive);
}

export function chooseRestoredGame(
  snapshot: GameSessionState | null,
  buffered: GameSessionState | null,
  roomCode: string,
): GameSessionState | null {
  if (
    !snapshot ||
    !buffered ||
    buffered.roomCode !== roomCode ||
    buffered.sessionId !== snapshot.sessionId
  ) {
    return snapshot;
  }
  if (
    typeof buffered.revision === "number" &&
    typeof snapshot.revision === "number" &&
    buffered.revision > snapshot.revision
  ) {
    return buffered;
  }
  return snapshot;
}

type LobbyRevision = { roomCode: string; revision: number; status: string };

export function needsFreshGameSnapshot(snapshot: LobbyRevision, latest: LobbyRevision): boolean {
  return latest.roomCode === snapshot.roomCode && latest.revision > snapshot.revision &&
    snapshot.status === "lobby" && latest.status === "starting";
}
