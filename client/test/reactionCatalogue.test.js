import assert from "node:assert/strict";
import test from "node:test";
import { catalogue, entries, categories, findReactions } from "../src/reactionCatalogue.ts";
import { recentReactions, rememberReaction } from "../src/recentReactions.ts";

test("every catalogue sequence satisfies the server reaction contract", () => {
  assert.equal(entries.length, 3790);
  assert.equal(new Set(entries.map(entry => entry.emoji)).size, entries.length);
  assert.deepEqual(new Set(entries.map(entry => entry.category)), new Set(categories.slice(1)));
  for (const { emoji, name } of entries) {
    assert.ok(name && emoji.length <= 32 && /^\p{RGI_Emoji}$/v.test(emoji), emoji);
  }
  for (const emoji of ["👩🏽‍🚀", "👍🏿", "🇮🇳", "👨‍👩‍👧‍👦"]) assert.ok(catalogue.has(emoji));
  for (const invalid of ["text", "🇦", "👍👍", ""]) assert.equal(catalogue.has(invalid), false);
  for (const [term, emoji] of [["laugh","🤣"], ["cry","😭"], ["celebration","🎉"], ["heart","❤️"], ["fire","🔥"], ["cat","🐈"], ["thumbs up","👍🏿"]]) {
    assert.ok(findReactions(term).some(entry => entry.emoji === emoji), term);
  }
});

test("recents persist exact sequences per player, deduplicate, validate and tolerate storage failures", async t => {
  const values = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => { if (original) Object.defineProperty(globalThis, "localStorage", original); else delete globalThis.localStorage; });
  const valid = emoji => catalogue.has(emoji);
  for (const entry of entries.slice(0, 30)) rememberReaction("one", entry.emoji);
  rememberReaction("one", "👩🏽‍🚀");
  rememberReaction("one", "👍");
  rememberReaction("one", "👩🏽‍🚀");
  const freshModule = await import("../src/recentReactions.ts?refresh");
  const restored = freshModule.recentReactions("one", valid);
  assert.equal(restored.length, 24);
  assert.equal(new Set(restored).size, 24);
  assert.deepEqual(restored.slice(0, 2), ["👩🏽‍🚀", "👍"]);
  assert.deepEqual(recentReactions("two", valid), []);
  values.set("sussed:recent-emoji:v1:two", "{");
  assert.deepEqual(recentReactions("two", valid), []);
  values.set("sussed:recent-emoji:v1:two", JSON.stringify(["hello", "👍", 3, "👍"]));
  assert.deepEqual(recentReactions("two", valid), ["👍"]);
  storage.setItem = () => { throw Error("storage unavailable"); };
  rememberReaction("two", "🇮🇳");
  assert.deepEqual(recentReactions("two", valid), ["🇮🇳", "👍"]);
});
