const { createClient } = require("@supabase/supabase-js");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID_TOKEN_MESSAGE = "Invalid or expired access token.";

function createSupabaseTokenVerifier({
    supabaseUrl = process.env.SUPABASE_URL,
    publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY,
    createClientFactory = createClient,
} = {}) {
    const configuredUrl = supabaseUrl?.trim();
    const configuredKey = publishableKey?.trim();
    if (!configuredUrl && !configuredKey) {
        return null;
    }
    if (!configuredUrl || !configuredKey) {
        throw new Error(
            "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must both be configured."
        );
    }

    const supabase = createClientFactory(configuredUrl, configuredKey, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
        },
    });

    return async (accessToken) => {
        const { data, error } = await supabase.auth.getUser(accessToken);
        if (error || !data.user || !UUID_PATTERN.test(data.user.id)) {
            throw new Error(INVALID_TOKEN_MESSAGE);
        }
        return data.user.id;
    };
}

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
                if (typeof accountId !== "string" || !UUID_PATTERN.test(accountId)) {
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
    createSupabaseTokenVerifier,
};
