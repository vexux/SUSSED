const fallback = new Map<string, string[]>();

export function recentReactions(playerId: string | null | undefined, supported: (emoji: string) => boolean): string[] {
  if (!playerId) return [];
  let values: unknown = fallback.get(playerId);
  if (!values) {
    try { values = JSON.parse(localStorage.getItem("sussed:recent-emoji:v1:" + playerId) ?? "[]"); }
    catch { return []; }
  }
  return Array.isArray(values) ? [...new Set(values.filter((v): v is string => typeof v === "string" && supported(v)))].slice(0, 24) : [];
}

export function rememberReaction(playerId: string | null | undefined, emoji: string) {
  if (!playerId) return;
  const previous = recentReactions(playerId, value => value.length <= 32);
  const values = [emoji, ...previous.filter(value => value !== emoji)].slice(0, 24);
  try {
    localStorage.setItem("sussed:recent-emoji:v1:" + playerId, JSON.stringify(values));
    fallback.delete(playerId);
  } catch { fallback.set(playerId, values); }
}
