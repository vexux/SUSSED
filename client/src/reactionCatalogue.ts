type Category = "Smileys" | "People" | "Animals" | "Food" | "Activities" | "Symbols";
type Entry = [emoji: string, name: string, keywords: string];

export const catalogue: Record<Category, Entry[]> = {
  Smileys: [
    ["😂", "Tears of joy", "laugh funny lol"], ["🤣", "Rolling on the floor laughing", "laugh funny rofl"],
    ["😮", "Surprised face", "wow shock"], ["😭", "Loudly crying", "cry sad tears"],
    ["🥹", "Holding back tears", "cry happy"], ["😎", "Sunglasses", "cool"], ["🥳", "Party face", "celebration birthday"],
    ["🤔", "Thinking face", "hmm suspect"], ["😍", "Heart eyes", "love"], ["😅", "Grinning with sweat", "awkward relief"],
  ],
  People: [
    ["👍", "Thumbs up", "yes agree"], ["👎", "Thumbs down", "no disagree"], ["👏", "Clapping", "applause celebration"],
    ["🙌", "Raised hands", "celebration hooray"], ["🫶", "Heart hands", "love"], ["🤝", "Handshake", "deal agree"],
    ["👀", "Eyes", "look watching"], ["💪", "Flexed arm", "strong muscle"],
  ],
  Animals: [
    ["🐶", "Dog", "puppy"], ["🐱", "Cat", "kitten"], ["🐐", "Goat", "greatest"], ["🦊", "Fox", "clever"],
    ["🐸", "Frog", "toad"], ["🐼", "Panda", "bear"], ["🦋", "Butterfly", "pretty"], ["🐧", "Penguin", "bird"],
  ],
  Food: [
    ["🍕", "Pizza", "slice"], ["🍿", "Popcorn", "watch drama"], ["🌶️", "Hot pepper", "spicy chili"],
    ["🎂", "Birthday cake", "celebration"], ["🍪", "Cookie", "biscuit"], ["🍉", "Watermelon", "fruit"],
    ["🍔", "Burger", "hamburger"], ["☕", "Coffee", "drink tea"],
  ],
  Activities: [
    ["🎉", "Party popper", "celebration confetti"], ["🎊", "Confetti ball", "celebration party"],
    ["🏆", "Trophy", "winner award"], ["🎯", "Bullseye", "target accurate"], ["🎮", "Video game", "controller"],
    ["🎲", "Dice", "luck roll"], ["⚽", "Soccer ball", "football sport"], ["🚀", "Rocket", "launch space"],
  ],
  Symbols: [
    ["❤️", "Red heart", "love"], ["💜", "Purple heart", "love"], ["💔", "Broken heart", "sad"],
    ["🔥", "Fire", "flame hot"], ["✨", "Sparkles", "magic stars"], ["✅", "Check mark", "correct yes"],
    ["💯", "Hundred points", "perfect score"], ["❓", "Question mark", "what confused"],
  ],
};

export const categories = Object.keys(catalogue) as Category[];
export const quickReactions = ["👍", "❤️", "😂", "😮", "😭", "🔥"];

export function findReactions(category: Category, query: string): Entry[] {
  const term = query.trim().toLowerCase();
  return term ? Object.values(catalogue).flat().filter(entry => entry.join(" ").toLowerCase().includes(term)) : catalogue[category];
}
