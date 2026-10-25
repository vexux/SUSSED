const FIREBASE_PROJECT_ID = "sussed-167f0";
const FIREBASE_AUTH_EMULATOR_PROJECT_ID = "demo-sussed-167f0";
const FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

function resolveFirebaseAuthConfig({
    emulatorEnabled,
    nodeEnv,
    projectId,
    emulatorHost,
}) {
    const setting = emulatorEnabled?.trim().toLowerCase();
    if (setting && setting !== "true" && setting !== "false") {
        throw new Error("FIREBASE_AUTH_EMULATOR_ENABLED must be set to true or false.");
    }

    const enabled = setting === "true";
    const configuredHost = emulatorHost?.trim();

    if (!enabled && configuredHost) {
        throw new Error(
            "FIREBASE_AUTH_EMULATOR_HOST is set without FIREBASE_AUTH_EMULATOR_ENABLED=true."
        );
    }

    if (enabled) {
        if (nodeEnv !== "development") {
            throw new Error(
                "Firebase Auth Emulator mode can only be enabled when NODE_ENV=development."
            );
        }
        if (projectId?.trim() !== FIREBASE_AUTH_EMULATOR_PROJECT_ID) {
            throw new Error(
                `FIREBASE_PROJECT_ID must be ${FIREBASE_AUTH_EMULATOR_PROJECT_ID} in emulator mode.`
            );
        }
        if (configuredHost && configuredHost !== FIREBASE_AUTH_EMULATOR_HOST) {
            throw new Error(
                `FIREBASE_AUTH_EMULATOR_HOST must be ${FIREBASE_AUTH_EMULATOR_HOST}.`
            );
        }

        return {
            emulatorEnabled: true,
            projectId: FIREBASE_AUTH_EMULATOR_PROJECT_ID,
            emulatorHost: FIREBASE_AUTH_EMULATOR_HOST,
        };
    }

    const configuredProjectId = projectId?.trim() || FIREBASE_PROJECT_ID;
    if (configuredProjectId !== FIREBASE_PROJECT_ID) {
        throw new Error(`FIREBASE_PROJECT_ID must be ${FIREBASE_PROJECT_ID}.`);
    }

    return {
        emulatorEnabled: false,
        projectId: FIREBASE_PROJECT_ID,
        emulatorHost: null,
    };
}

module.exports = {
    FIREBASE_AUTH_EMULATOR_HOST,
    FIREBASE_AUTH_EMULATOR_PROJECT_ID,
    FIREBASE_PROJECT_ID,
    resolveFirebaseAuthConfig,
};
