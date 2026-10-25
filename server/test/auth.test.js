const assert = require("node:assert/strict");
const test = require("node:test");
const { createFirebaseTokenVerifier } = require("../auth");

test("requires Firebase project configuration to verify authenticated sockets", () => {
    assert.equal(createFirebaseTokenVerifier({ projectId: "" }), null);
});

test("verifies Firebase ID tokens and returns the verified UID", async () => {
    const accountId = "firebase-user-123";
    let receivedToken;
    const verify = createFirebaseTokenVerifier({
        projectId: "firebase-project",
        verifyIdToken: async (token) => {
            receivedToken = token;
            return { uid: accountId };
        },
    });

    assert.equal(await verify("access-token"), accountId);
    assert.equal(receivedToken, "access-token");
});

test("rejects invalid Firebase verification results and missing UIDs", async () => {
    for (const decoded of [null, {}, { uid: "" }]) {
        const verify = createFirebaseTokenVerifier({
            projectId: "firebase-project",
            verifyIdToken: async () => decoded,
        });
        await assert.rejects(verify("access-token"), /Invalid or expired access token/);
    }
});
