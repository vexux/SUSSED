export const MAX_PLAYER_NAME_LENGTH = 20;

export function validatePlayerName(name: string): string | null {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_PLAYER_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    return `Enter a player name between 1 and ${MAX_PLAYER_NAME_LENGTH} characters.`;
  }
  return null;
}
