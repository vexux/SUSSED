const assert = require("node:assert/strict");
const test = require("node:test");
const {
    createFirebaseTokenVerifier,
    FIREBASE_PROJECT_ID,
} = require("../auth");

test("requires Firebase project configuration to verify authenticated sockets", () => {
    assert.equal(createFirebaseTokenVerifier({ projectId: "" }), null);
});

test("verifies Firebase ID tokens and returns the verified UID", async () => {
    const accountId = "firebase-user-123";
    let receivedToken;
    let receivedProjectId;
    const verify = createFirebaseTokenVerifier({
        projectId: FIREBASE_PROJECT_ID,
        verifyIdToken: async (token, projectId) => {
            receivedToken = token;
            receivedProjectId = projectId;
            return { uid: accountId };
        },
    });

    assert.equal(await verify("access-token"), accountId);
    assert.equal(receivedToken, "access-token");
    assert.equal(receivedProjectId, FIREBASE_PROJECT_ID);
});

test("rejects invalid Firebase verification results and missing UIDs", async () => {
    for (const decoded of [null, {}, { uid: "" }]) {
        const verify = createFirebaseTokenVerifier({
            projectId: FIREBASE_PROJECT_ID,
            verifyIdToken: async () => decoded,
        });
        await assert.rejects(verify("access-token"), /Invalid or expired access token/);
    }
});

test("rejects server configuration for a different Firebase project", () => {
    assert.throws(
        () => createFirebaseTokenVerifier({ projectId: "another-project" }),
        /FIREBASE_PROJECT_ID must be sussed-167f0/,
    );
});
