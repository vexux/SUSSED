import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createSubmissionProgress,
  createVoteProgress,
} from "../src/ui/gamePresentation.ts";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  query(predicate) {
    return this.children.find(predicate) ?? this.children.map((child) => child.query(predicate)).find(Boolean) ?? null;
  }
}

function withFakeDocument(run) {
  const original = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
  };
  try {
    run();
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
}

function getAvatarStatus(item) {
  return item.query((element) => element.className.includes("avatar-status-badge"));
}

test("answer and vote progress share accessible avatar statuses and player identity", () => {
  withFakeDocument(() => {
    const players = [
      { playerId: "p1", name: "Alex Rivera", submitted: false, voted: false },
      { playerId: "p2", name: "Sam", submitted: true, voted: true },
    ];
    const [submissionCount, submissions] = createSubmissionProgress(
      1,
      2,
      players,
    );
    const [voteCount, votes] = createVoteProgress(1, 2, players);

    assert.equal(submissionCount.textContent, "1 of 2 answers submitted");
    assert.equal(voteCount.textContent, "1 of 2 players voted");
    assert.equal(submissions.className, "submission-player-list avatar-status-list");
    assert.equal(votes.className, "vote-player-list avatar-status-list");

    for (const list of [submissions, votes]) {
      assert.equal(list.children.length, 2);
      assert.deepEqual(list.children.map((item) => item.dataset.playerId), ["p1", "p2"]);
      assert.deepEqual(list.children.map((item) => item.children[1].textContent), ["Alex Rivera", "Sam"]);
      assert.deepEqual(
        list.children.map((item) => item.children[0].children[0].textContent),
        ["AR", "SA"],
      );
      assert.ok(list.children.every((item) => item.children[0].className === "avatar-status-wrapper"));
      assert.ok(list.children.every((item) => item.children[0].children[0].attributes["aria-hidden"] === "true"));
    }

    for (const [list, completeLabel] of [[submissions, "Submitted"], [votes, "Voted"]]) {
      const [waiting, complete] = list.children.map(getAvatarStatus);
      assert.equal(waiting.attributes["aria-label"], "Waiting");
      assert.equal(waiting.className, "avatar-status-badge avatar-status-badge-waiting");
      assert.equal(complete.attributes["aria-label"], completeLabel);
      assert.equal(complete.className, "avatar-status-badge avatar-status-badge-complete");
      assert.equal(waiting.children[0].tagName, "svg");
      assert.equal(complete.children[0].tagName, "svg");
    }
  });
});

test("avatar status layout anchors equal-sized badges and animates only the hourglass", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(css, /\.avatar-status-wrapper\s*\{[^}]*position:\s*relative/su);
  assert.match(css, /\.player-avatar\s*\{[^}]*display:\s*grid/su);
  assert.match(css, /\.player-avatar\s*\{[^}]*place-items:\s*center/su);
  assert.match(css, /\.avatar-status-badge\s*\{[^}]*position:\s*absolute/su);
  assert.match(css, /\.avatar-status-badge\s*\{[^}]*top:\s*-4px/su);
  assert.match(css, /\.avatar-status-badge\s*\{[^}]*right:\s*-4px/su);
  assert.match(css, /\.avatar-status-badge\s*\{[^}]*width:\s*18px/su);
  assert.match(css, /\.avatar-status-badge\s*\{[^}]*height:\s*18px/su);
  assert.match(css, /\.avatar-status-badge-waiting svg\s*\{[^}]*animation:\s*avatar-hourglass-rotate/su);
  assert.doesNotMatch(css, /\.avatar-status-badge\s*\{[^}]*animation:/su);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.avatar-status-badge-waiting svg\s*\{[^}]*animation:\s*none !important/su);
});
