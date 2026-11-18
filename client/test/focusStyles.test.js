import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesheet = await readFile(
  new URL("../src/style.css", import.meta.url),
  "utf8",
);

test("non-interactive screen targets have no decorative focus outline", () => {
  assert.doesNotMatch(
    stylesheet,
    /\.question-screen:focus\b|\.lobby-screen\s+h1:focus\b|\.starting-screen\s*>\s*h1:focus\b/u,
  );
  assert.match(
    stylesheet,
    /\.app-screen:focus,\s*\.app-screen h1:focus,\s*\.social-profile-card:focus\s*\{\s*outline:\s*none\s*;/u,
  );
});

test("choice cards only add a focus outline for keyboard-focused controls", () => {
  assert.match(stylesheet, /\.vote-option:has\(input:focus-visible\)/u);
  assert.doesNotMatch(stylesheet, /\.vote-option:focus-within\b/u);
  assert.match(stylesheet, /\.visibility-option:has\(input:focus-visible\)/u);
});

test("interactive controls retain visible keyboard focus indicators", () => {
  assert.match(stylesheet, /\.text-input:focus-visible[\s\S]*?outline:\s*var\(--focus-ring\)/u);
  assert.match(stylesheet, /button:focus-visible\s*\{\s*outline:\s*var\(--focus-ring\)/u);
  assert.match(stylesheet, /\.account-menu-item:focus-visible/u);
});
