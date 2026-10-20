import assert from "node:assert/strict";
import test from "node:test";
import {
  copyText,
  createInvitationUrl,
  parseInvitationCode,
  shareOrCopyInvitation,
} from "../src/invitations.ts";

test("invitation links use the configured public origin and encode the room code", () => {
  assert.equal(
    createInvitationUrl(" zing ", "http://localhost:5173/?old=1", "https://play.example"),
    "https://play.example/?code=ZING",
  );
  assert.equal(
    createInvitationUrl("ATOM", "https://play.example/subpath/"),
    "https://play.example/?code=ATOM",
  );
  assert.throws(() => createInvitationUrl("BAD CODE", "https://play.example/"));
  assert.throws(() => createInvitationUrl("ATOM", "https://play.example/", "javascript:alert(1)"));
});

test("invitation codes parse once, normalize case, and reject malformed or ambiguous values", () => {
  assert.deepEqual(parseInvitationCode(""), { status: "missing", code: null });
  assert.deepEqual(parseInvitationCode("?code=zing"), { status: "valid", code: "ZING" });
  assert.deepEqual(parseInvitationCode("?code=%20Atom%20"), { status: "valid", code: "ATOM" });
  assert.deepEqual(parseInvitationCode("?code="), { status: "invalid", code: null });
  assert.deepEqual(parseInvitationCode("?code=TOOLONG"), { status: "invalid", code: null });
  assert.deepEqual(parseInvitationCode("?code=ATOM&code=BEAM"), { status: "invalid", code: null });
});

test("copying falls back after clipboard denial and reports failure if both paths fail", async () => {
  let fallbackValue = null;
  await copyText("https://play.example/?code=ATOM", {
    writeText: async () => { throw new Error("permission denied"); },
    fallbackCopy: (value) => { fallbackValue = value; return true; },
  });
  assert.equal(fallbackValue, "https://play.example/?code=ATOM");
  await assert.rejects(copyText("ATOM", { fallbackCopy: () => false }), /clipboard failed/u);
});

test("native sharing falls back to copying when unavailable or rejected", async () => {
  const invitation = { title: "Join", text: "Join my room", url: "https://play.example/?code=ATOM" };
  const copied = [];
  assert.equal(await shareOrCopyInvitation(invitation, {
    copy: async (value) => { copied.push(value); },
  }), "copied");
  assert.equal(await shareOrCopyInvitation(invitation, {
    share: async () => { throw new Error("share rejected"); },
    copy: async (value) => { copied.push(value); },
  }), "copied");
  assert.equal(await shareOrCopyInvitation(invitation, {
    share: async () => {},
    copy: async () => { throw new Error("should not copy"); },
  }), "shared");
  assert.deepEqual(copied, [invitation.url, invitation.url]);
});
