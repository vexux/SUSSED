const assert = require("node:assert/strict");
const test = require("node:test");
const {
    createFirebaseTokenVerifier,
    FIREBASE_AUTH_EMULATOR_PROJECT_ID,
    FIREBASE_PROJECT_ID,
} = require("../auth");
const {
    FIREBASE_AUTH_EMULATOR_HOST,
    resolveFirebaseAuthConfig,
} = require("../firebaseAuthConfig");

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

test("resolves Auth Emulator configuration only for explicit local demo-project mode", () => {
    assert.deepEqual(
        resolveFirebaseAuthConfig({
            emulatorEnabled: "true",
            nodeEnv: "development",
            projectId: FIREBASE_AUTH_EMULATOR_PROJECT_ID,
        }),
        {
            emulatorEnabled: true,
            projectId: FIREBASE_AUTH_EMULATOR_PROJECT_ID,
            emulatorHost: FIREBASE_AUTH_EMULATOR_HOST,
        },
    );
});

test("rejects Auth Emulator mode in production or when the host is set implicitly", () => {
    assert.throws(
        () => resolveFirebaseAuthConfig({
            emulatorEnabled: "true",
            nodeEnv: "production",
            projectId: FIREBASE_AUTH_EMULATOR_PROJECT_ID,
        }),
        /only be enabled when NODE_ENV=development/,
    );
    assert.throws(
        () => resolveFirebaseAuthConfig({
            emulatorEnabled: "false",
            nodeEnv: "development",
            projectId: FIREBASE_PROJECT_ID,
            emulatorHost: FIREBASE_AUTH_EMULATOR_HOST,
        }),
        /without FIREBASE_AUTH_EMULATOR_ENABLED=true/,
    );
    assert.throws(
        () => resolveFirebaseAuthConfig({
            emulatorEnabled: "true",
            nodeEnv: "development",
            projectId: FIREBASE_PROJECT_ID,
        }),
        /demo-sussed-167f0/,
    );
});

test("normal server verification uses the production Firebase project when emulator mode is off", () => {
    assert.deepEqual(
        resolveFirebaseAuthConfig({
            emulatorEnabled: "false",
            nodeEnv: "development",
            projectId: FIREBASE_PROJECT_ID,
        }),
        {
            emulatorEnabled: false,
            projectId: FIREBASE_PROJECT_ID,
            emulatorHost: null,
        },
    );
});

test("Firebase Auth Emulator token verification uses the demo project ID", async () => {
    const originalEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    let receivedProjectId;
    try {
        const verify = createFirebaseTokenVerifier({
            emulatorEnabled: "true",
            nodeEnv: "development",
            projectId: FIREBASE_AUTH_EMULATOR_PROJECT_ID,
            verifyIdToken: async (token, projectId) => {
                assert.equal(token, "emulator-id-token");
                receivedProjectId = projectId;
                return { uid: "emulator-user-123" };
            },
        });

        assert.equal(await verify("emulator-id-token"), "emulator-user-123");
        assert.equal(receivedProjectId, FIREBASE_AUTH_EMULATOR_PROJECT_ID);
        assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
    } finally {
        if (originalEmulatorHost === undefined) {
            delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
        } else {
            process.env.FIREBASE_AUTH_EMULATOR_HOST = originalEmulatorHost;
        }
    }
});
