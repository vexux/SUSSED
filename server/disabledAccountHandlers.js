const DISABLED_ACCOUNT_EVENTS = Object.freeze([
    "get-profile",
    "update-profile-display-name",
    "update-profile-handle",
    "search-profiles",
    "get-public-profile",
    "get-social-data",
    "get-notifications",
    "mark-notification-read",
    "send-friend-request",
    "respond-friend-request",
    "cancel-friend-request",
    "remove-friend",
    "send-game-invitation",
    "decline-game-invitation",
    "accept-game-invitation",
]);

function registerDisabledAccountHandlers(socket) {
    for (const eventName of DISABLED_ACCOUNT_EVENTS) {
        socket.on(eventName, (...args) => {
            const acknowledge = args[args.length - 1];
            if (typeof acknowledge === "function") {
                acknowledge({
                    error: {
                        code: "AUTH_DISABLED",
                        message: "Authentication and account features are disabled on this server.",
                    },
                });
            }
        });
    }
}

module.exports = { DISABLED_ACCOUNT_EVENTS, registerDisabledAccountHandlers };
