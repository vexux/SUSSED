import assert from "node:assert/strict";
import test from "node:test";
import { createInitialAppState, LANDING_TAGLINES } from "../src/appState.ts";
import { renderApp } from "../src/views.ts";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.classList = { add: (...names) => { this.className = `${this.className} ${names.join(" ")}`.trim(); } };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  dispatch(type) { this.listeners[type]?.({ preventDefault() {}, stopPropagation() {} }); }
  query(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const result = child.query(predicate);
      if (result) return result;
    }
    return null;
  }
  get text() { return `${this.textContent}${this.children.map((child) => child.text).join("")}`; }
}

function withFakeDocument(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try { callback(); }
  finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test("landing page selects a tagline once and keeps its form interactions usable", () => {
  withFakeDocument(() => {
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      const state = createInitialAppState();
      state.connectionStatus = "connected";
      const selected = state.landingTagline;
      assert.ok(LANDING_TAGLINES.includes(selected));
      assert.equal(selected, LANDING_TAGLINES[Math.floor(LANDING_TAGLINES.length * 0.5)]);
      Math.random = () => 0;
      assert.equal(createInitialAppState().landingTagline, LANDING_TAGLINES[0]);
      Math.random = () => 0.5;

      const calls = { create: 0, join: [], names: [] };
      const actions = {
        onPlayerNameChange(name) { state.playerName = name; state.errorMessage = null; state.errorCode = null; calls.names.push(name); },
        onCreateRoom() { calls.create += 1; },
        onJoinRoom(code) { calls.join.push(code); },
      };
      const root = new FakeElement("root");
      const render = () => renderApp(root, state, actions, {}, {});
      render();
      const tagline = root.query((element) => element.className.includes("landing-tagline"));
      const nameInput = root.query((element) => element.id === "player-name");
      const codeInput = root.query((element) => element.id === "room-code");
      assert.equal(tagline.textContent, selected);
      assert.equal(codeInput.placeholder, "CODE");
      assert.equal(root.text.includes("Room codes are memorable four-letter words."), false);

      nameInput.value = "Alex";
      nameInput.dispatch("input");
      render();
      assert.equal(state.landingTagline, selected);
      assert.equal(root.query((element) => element.className.includes("landing-tagline")).textContent, selected);
      assert.equal(root.query((element) => element.id === "player-name").value, "Alex");
      root.query((element) => element.textContent === "Create room").dispatch("click");
      root.query((element) => element.id === "room-code").value = "ABCD";
      root.query((element) => element.textContent === "Join room").dispatch("click");
      assert.equal(calls.create, 1);
      assert.deepEqual(calls.join, ["ABCD"]);
      assert.deepEqual(calls.names, ["Alex"]);
    } finally {
      Math.random = originalRandom;
    }
  });
});

test("duplicate-name feedback is shown by the name field and can be cleared for retry", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.connectionStatus = "connected";
    state.playerName = "Alex";
    state.errorCode = "DUPLICATE_PLAYER_NAME";
    state.errorMessage = "That name is already used in this room. Choose another name.";
    const actions = {
      onPlayerNameChange(name) { state.playerName = name; state.errorMessage = null; state.errorCode = null; },
      onCreateRoom() {},
      onJoinRoom() {},
    };
    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});
    const error = root.query((element) => element.className.includes("duplicate-name-error"));
    assert.equal(error.textContent, state.errorMessage);
    assert.equal(error.attributes.role, "alert");
    assert.equal(root.query((element) => element.tagName === "input" && element.id === "player-name").value, "Alex");

    const editedName = root.query((element) => element.id === "player-name");
    editedName.value = "Alex Two";
    editedName.dispatch("input");
    assert.equal(state.playerName, "Alex Two");
    assert.equal(state.errorCode, null);
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.className.includes("duplicate-name-error")), null);
  });
});
