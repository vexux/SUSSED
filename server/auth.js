const admin = require("firebase-admin");
const {
    resolveFirebaseAuthConfig,
    FIREBASE_AUTH_EMULATOR_HOST,
    FIREBASE_AUTH_EMULATOR_PROJECT_ID,
    FIREBASE_PROJECT_ID,
} = require("./firebaseAuthConfig");

const INVALID_TOKEN_MESSAGE = "Invalid or expired access token.";
const VERIFICATION_UNAVAILABLE_MESSAGE =
    "Authentication verification is temporarily unavailable.";
const INVALID_TOKEN_CODES = new Set([
    "auth/argument-error",
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/invalid-id-token",
    "auth/user-disabled",
]);

function invalidTokenError() {
    return Object.assign(new Error(INVALID_TOKEN_MESSAGE), {
        code: "auth/invalid-id-token",
    });
}

function getFirebaseCredentialConfig(projectId) {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (Boolean(clientEmail) !== Boolean(privateKey)) {
        throw new Error(
            "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must both be configured."
        );
    }

    if (clientEmail && privateKey) {
        return {
            projectId: projectId || FIREBASE_PROJECT_ID,
            credential: admin.credential.cert({
                projectId: projectId || FIREBASE_PROJECT_ID,
                clientEmail,
                privateKey,
            }),
        };
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
        return {
            projectId,
            credential: admin.credential.applicationDefault(),
        };
    }

    return null;
}

function initializeFirebaseAdmin(projectId, emulatorEnabled = false) {
    const existingApp = admin.apps.find(({ name }) => name === "[DEFAULT]");
    if (existingApp) {
        if (existingApp.options.projectId !== projectId) {
            throw new Error(
                `Firebase Admin is initialized for a different project; expected ${FIREBASE_PROJECT_ID}.`
            );
        }
        return existingApp;
    }

    if (!admin.apps.length) {
        const credentialConfig = emulatorEnabled
            ? null
            : getFirebaseCredentialConfig(projectId);
        if (credentialConfig) {
            admin.initializeApp({
                projectId,
                credential: credentialConfig.credential,
            });
        } else {
            admin.initializeApp({ projectId });
        }
    }
    return admin.app();
}

function createFirebaseTokenVerifier({
    projectId = process.env.FIREBASE_PROJECT_ID,
    verifyIdToken = null,
    emulatorEnabled = process.env.FIREBASE_AUTH_EMULATOR_ENABLED,
    nodeEnv = process.env.NODE_ENV,
    emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST,
} = {}) {
    const firebaseConfig = resolveFirebaseAuthConfig({
        emulatorEnabled,
        nodeEnv,
        projectId,
        emulatorHost,
    });
    const configuredProjectId = firebaseConfig.projectId;
    if (firebaseConfig.emulatorEnabled) {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = FIREBASE_AUTH_EMULATOR_HOST;
    }
    const hasFirebaseConfig = Boolean(
        verifyIdToken ||
        firebaseConfig.emulatorEnabled ||
        process.env.FIREBASE_PROJECT_ID ||
        process.env.FIREBASE_CLIENT_EMAIL ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.FIREBASE_PRIVATE_KEY,
    );

    if (!hasFirebaseConfig) {
        return null;
    }

    if (verifyIdToken) {
        return async (accessToken) => {
            if (typeof accessToken !== "string" || accessToken.length === 0) {
                throw invalidTokenError();
            }
            const decoded = await verifyIdToken(accessToken, configuredProjectId);
            if (typeof decoded?.uid !== "string" || decoded.uid.length === 0) {
                throw invalidTokenError();
            }
            return decoded.uid;
        };
    }

    initializeFirebaseAdmin(configuredProjectId, firebaseConfig.emulatorEnabled);

    return async (accessToken) => {
        if (typeof accessToken !== "string" || accessToken.length === 0) {
            throw invalidTokenError();
        }

        const decoded = await admin.app().auth().verifyIdToken(accessToken);
        if (typeof decoded.uid !== "string" || decoded.uid.length === 0) {
            throw invalidTokenError();
        }

        return decoded.uid;
    };
}

const createSupabaseTokenVerifier = createFirebaseTokenVerifier;

function createSocketAuthMiddleware(
    verifyAccessToken,
    reportVerificationFailure = (errorCode) => {
        console.error("Firebase ID token verification failed:", errorCode);
    },
) {
    return (socket, next) => {
        const auth = socket.handshake.auth;
        if (!auth || !Object.hasOwn(auth, "accessToken")) {
            next();
            return;
        }

        const { accessToken } = auth;
        if (typeof accessToken !== "string" || accessToken.length === 0 || !verifyAccessToken) {
            next(new Error(INVALID_TOKEN_MESSAGE));
            return;
        }

        Promise.resolve()
            .then(() => verifyAccessToken(accessToken))
            .then((accountId) => {
                if (typeof accountId !== "string" || accountId.length === 0) {
                    throw invalidTokenError();
                }
                socket.data.accountId = accountId;
                next();
            })
            .catch((error) => {
                const errorCode =
                    error && typeof error.code === "string" ? error.code : "unknown";
                reportVerificationFailure(errorCode);
                next(new Error(
                    INVALID_TOKEN_CODES.has(errorCode)
                        ? INVALID_TOKEN_MESSAGE
                        : VERIFICATION_UNAVAILABLE_MESSAGE
                ));
            });
    };
}

module.exports = {
    createSocketAuthMiddleware,
    createFirebaseTokenVerifier,
    createSupabaseTokenVerifier,
    FIREBASE_PROJECT_ID,
    FIREBASE_AUTH_EMULATOR_PROJECT_ID,
    INVALID_TOKEN_MESSAGE,
    VERIFICATION_UNAVAILABLE_MESSAGE,
};
