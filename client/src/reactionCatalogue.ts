import data from "emojibase-data/en/compact.json" with { type: "json" };
import aliases from "emojibase-data/en/shortcodes/emojibase.json" with { type: "json" };

export const categories = ["Recently Used", "Smileys & People", "Animals & Nature", "Food & Drink", "Travel & Places", "Activities", "Objects", "Symbols", "Flags"] as const;
export type Category = typeof categories[number];
export interface Entry { emoji: string; name: string; category: Category; search: string }

const groupNames: Category[] = [categories[1], categories[1], categories[1], ...categories.slice(2)];
export const catalogue = new Map<string, Entry>();
for (const base of data) {
  // Uncategorised components (such as isolated regional indicators) are not reactions.
  if (base.group === undefined) continue;
  for (const item of [base, ...(base.skins ?? [])]) {
    // Some default-emoji singletons have a redundant presentation selector in Emojibase.
    const emoji = item.unicode.replace(/^(\p{Emoji_Presentation})\uFE0F$/u, (_, singleton: string) => singleton);
    const words = [item.label, base.label, ...(base.tags ?? []), aliases[base.hexcode], aliases[item.hexcode], emoji];
    const search = words.flat().filter(Boolean).join(" ").replaceAll("_", " ").toLowerCase();
    catalogue.set(emoji, { emoji, name: item.label, category: groupNames[base.group]!, search });
  }
}
export const entries = Array.from(catalogue.values());
export function findReactions(query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/);
  return entries.filter(entry => terms.every(term => entry.search.includes(term)));
}
