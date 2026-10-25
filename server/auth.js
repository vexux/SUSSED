const admin = require("firebase-admin");

const INVALID_TOKEN_MESSAGE = "Invalid or expired access token.";

function getFirebaseCredentialConfig() {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (clientEmail && privateKey) {
        return {
            projectId,
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey,
            }),
        };
    }

    if (projectId || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return {
            projectId,
            credential: admin.credential.applicationDefault(),
        };
    }

    return null;
}

function initializeFirebaseAdmin(projectId = process.env.FIREBASE_PROJECT_ID) {
    if (!admin.apps.length) {
        const credentialConfig = getFirebaseCredentialConfig();
        if (credentialConfig) {
            admin.initializeApp({
                projectId: credentialConfig.projectId || projectId,
                credential: credentialConfig.credential,
            });
        } else if (projectId) {
            admin.initializeApp({ projectId });
        } else {
            admin.initializeApp();
        }
    }
    return admin.app();
}

function createFirebaseTokenVerifier({
    projectId = process.env.FIREBASE_PROJECT_ID,
    verifyIdToken = null,
} = {}) {
    const configuredProjectId = projectId?.trim();
    const hasFirebaseConfig = Boolean(
        configuredProjectId ||
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
                throw new Error(INVALID_TOKEN_MESSAGE);
            }
            const decoded = await verifyIdToken(accessToken);
            if (typeof decoded?.uid !== "string" || decoded.uid.length === 0) {
                throw new Error(INVALID_TOKEN_MESSAGE);
            }
            return decoded.uid;
        };
    }

    initializeFirebaseAdmin(configuredProjectId);

    return async (accessToken) => {
        if (typeof accessToken !== "string" || accessToken.length === 0) {
            throw new Error(INVALID_TOKEN_MESSAGE);
        }

        const decoded = await admin.app().auth().verifyIdToken(accessToken);
        if (typeof decoded.uid !== "string" || decoded.uid.length === 0) {
            throw new Error(INVALID_TOKEN_MESSAGE);
        }

        return decoded.uid;
    };
}

const createSupabaseTokenVerifier = createFirebaseTokenVerifier;

function createSocketAuthMiddleware(verifyAccessToken) {
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
                    throw new Error(INVALID_TOKEN_MESSAGE);
                }
                socket.data.accountId = accountId;
                next();
            })
            .catch(() => next(new Error(INVALID_TOKEN_MESSAGE)));
    };
}

module.exports = {
    createSocketAuthMiddleware,
    createFirebaseTokenVerifier,
    createSupabaseTokenVerifier,
};
