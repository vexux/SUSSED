const ERROR_MESSAGES = {
    AUTH_REQUIRED: "Sign in with a verified account to use profiles.",
    INVALID_INPUT: "The supplied profile or social data is invalid.",
    INVALID_DISPLAY_NAME: "Display name must be 2-20 characters.",
    INVALID_HANDLE: "Handle must be 3-20 lowercase letters or numbers.",
    HANDLE_COLLISION: "That handle is already in use.",
    HANDLE_COOLDOWN: "Your handle can only be changed once every 7 days.",
    INVALID_TRANSITION: "That social action is not currently available.",
    PROFILE_UNAVAILABLE: "Profiles are temporarily unavailable. Guest and room play can continue.",
};

// Socket protocol: get-profile/get-social-data take no payload; profile writes
// take {displayName}/{handle}; search takes {mode, query}; public lookup and
// friend add/remove take {handle}; respond/cancel take {action, requestId} /
// {requestId}. Reads acknowledge {profile}, {profiles}, or social lists; writes
// acknowledge {profile}, {requestId}, or {ok:true}. Account IDs always come
// from the authenticated socket and are never read from event payloads.
function getErrorCode(error) {
    return error && typeof error.code === "string" ? error.code : "PROFILE_UNAVAILABLE";
}

function registerProfileHandlers(socket, profileRepository, reportFailure = getErrorCode) {
    async function execute(acknowledge, operation, shape = (value) => ({ profile: value })) {
        if (typeof acknowledge !== "function") {
            return;
        }
        const accountId = socket.data && socket.data.accountId;
        if (typeof accountId !== "string" || accountId.length === 0) {
            acknowledge({
                error: {
                    code: "AUTH_REQUIRED",
                    message: ERROR_MESSAGES.AUTH_REQUIRED,
                },
            });
            return;
        }
        if (!profileRepository) {
            acknowledge({ error: { code: "PROFILE_UNAVAILABLE", message: ERROR_MESSAGES.PROFILE_UNAVAILABLE } });
            return;
        }
        try {
            acknowledge(shape(await operation(accountId)));
        } catch (error) {
            const code = getErrorCode(error);
            if (!ERROR_MESSAGES[code]) {
                reportFailure(code);
            } else if (code === "PROFILE_UNAVAILABLE") {
                reportFailure(code);
            }
            acknowledge({
                error: {
                    code: ERROR_MESSAGES[code] ? code : "PROFILE_UNAVAILABLE",
                    message: ERROR_MESSAGES[code] || ERROR_MESSAGES.PROFILE_UNAVAILABLE,
                },
            });
        }
    }

    socket.on("get-profile", (acknowledge) => {
        void execute(
            acknowledge,
            (accountId) => profileRepository.getOrCreateProfile(accountId),
        );
    });

    socket.on("update-profile-display-name", (payload, acknowledge) => {
        void execute(
            acknowledge,
            (accountId) => profileRepository.updateDisplayName(
                accountId,
                payload && typeof payload === "object" ? payload.displayName : undefined,
            ),
        );
    });

    socket.on("update-profile-handle", (payload, acknowledge) => {
        void execute(
            acknowledge,
            (accountId) => profileRepository.updateHandle(
                accountId,
                payload && typeof payload === "object" ? payload.handle : undefined,
            ),
        );
    });

    socket.on("search-profiles", (payload, acknowledge) => {
        void execute(
            acknowledge,
            (accountId) => profileRepository.searchProfiles(
                accountId,
                payload && typeof payload === "object" ? payload.mode : undefined,
                payload && typeof payload === "object" ? payload.query : undefined,
            ),
            (profiles) => ({ profiles }),
        );
    });

    socket.on("get-public-profile", (payload, acknowledge) => {
        void execute(
            acknowledge,
            (accountId) => profileRepository.getPublicProfile(
                accountId,
                payload && typeof payload === "object" ? payload.handle : undefined,
            ),
            (profile) => ({ profile }),
        );
    });

    socket.on("get-social-data", (acknowledge) => {
        void execute(
            acknowledge,
            (accountId) => profileRepository.getSocialData(accountId),
            (social) => social,
        );
    });

    socket.on("get-notifications", (payload, acknowledge) => {
        void execute(
            acknowledge,
            (accountId) => profileRepository.getNotifications(
                accountId,
                payload && typeof payload === "object" ? payload.limit ?? 20 : 20,
                payload && typeof payload === "object" ? payload.offset ?? 0 : 0,
            ),
            (notifications) => notifications,
        );
    });

    socket.on("mark-notification-read", (payload, acknowledge) => {
        void execute(
            acknowledge,
            async (accountId) => {
                await profileRepository.markNotificationRead(
                    accountId,
                    payload && typeof payload === "object" ? payload.notificationId : undefined,
                );
                return true;
            },
            () => ({ ok: true }),
        );
    });

    socket.on("send-friend-request", (payload, acknowledge) => {
        void execute(
            acknowledge,
            (accountId) => profileRepository.sendFriendRequest(
                accountId,
                payload && typeof payload === "object" ? payload.handle : undefined,
            ),
            (requestId) => ({ requestId }),
        );
    });

    socket.on("respond-friend-request", (payload, acknowledge) => {
        void execute(
            acknowledge,
            async (accountId) => {
                await profileRepository.respondFriendRequest(
                    accountId,
                    payload && typeof payload === "object" ? payload.requestId : undefined,
                    payload && typeof payload === "object" ? payload.action : undefined,
                );
                return true;
            },
            () => ({ ok: true }),
        );
    });

    socket.on("cancel-friend-request", (payload, acknowledge) => {
        void execute(
            acknowledge,
            async (accountId) => {
                await profileRepository.cancelFriendRequest(
                    accountId,
                    payload && typeof payload === "object" ? payload.requestId : undefined,
                );
                return true;
            },
            () => ({ ok: true }),
        );
    });

    socket.on("remove-friend", (payload, acknowledge) => {
        void execute(
            acknowledge,
            async (accountId) => {
                await profileRepository.removeFriend(
                    accountId,
                    payload && typeof payload === "object" ? payload.handle : undefined,
                );
                return true;
            },
            () => ({ ok: true }),
        );
    });
}

module.exports = { registerProfileHandlers };
