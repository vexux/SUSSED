import type { GameSessionState } from "./appState";

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
