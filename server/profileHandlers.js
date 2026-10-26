const PROFILE_UNAVAILABLE = {
    code: "PROFILE_UNAVAILABLE",
    message: "Profiles are temporarily unavailable. Guest and room play can continue.",
};

function getErrorCode(error) {
    return error && typeof error.code === "string" ? error.code : "unknown";
}

function registerProfileHandlers(socket, profileRepository, reportFailure = getErrorCode) {
    async function handleProfileOperation(operation, acknowledge) {
        if (typeof acknowledge !== "function") {
            return;
        }
        if (!socket.data.accountId) {
            acknowledge({
                error: {
                    code: "AUTH_REQUIRED",
                    message: "Sign in with a verified account to use profiles.",
                },
            });
            return;
        }
        if (!profileRepository) {
            acknowledge({ error: PROFILE_UNAVAILABLE });
            return;
        }

        try {
            acknowledge({ profile: await operation(socket.data.accountId) });
        } catch (error) {
            if (getErrorCode(error) === "INVALID_DISPLAY_NAME") {
                acknowledge({
                    error: {
                        code: "INVALID_DISPLAY_NAME",
                        message: error.message,
                    },
                });
                return;
            }
            reportFailure(getErrorCode(error));
            acknowledge({ error: PROFILE_UNAVAILABLE });
        }
    }

    socket.on("get-profile", (acknowledge) => {
        void handleProfileOperation(
            (accountId) => profileRepository.getOrCreateProfile(accountId),
            acknowledge,
        );
    });

    socket.on("update-profile-display-name", (payload, acknowledge) => {
        void handleProfileOperation(
            (accountId) =>
                profileRepository.updateDisplayName(
                    accountId,
                    payload && typeof payload === "object"
                        ? payload.displayName
                        : undefined,
                ),
            acknowledge,
        );
    });
}

module.exports = { registerProfileHandlers };
