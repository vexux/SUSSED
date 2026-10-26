const { createClient } = require("@supabase/supabase-js");

const PROFILE_FIELDS = "id, display_name";
const DISPLAY_NAME_MAX_LENGTH = 32;
const DEFAULT_DISPLAY_NAME = "Player";

function validateProfileId(profileId) {
    if (
        typeof profileId !== "string" ||
        Array.from(profileId).length === 0 ||
        Array.from(profileId).length > 128 ||
        /[\u0000-\u001f\u007f]/u.test(profileId)
    ) {
        throw new Error("Invalid Firebase account ID.");
    }
}

function validateDisplayName(displayName) {
    if (typeof displayName !== "string") {
        throw Object.assign(new Error("Display name must be text."), {
            code: "INVALID_DISPLAY_NAME",
        });
    }

    const normalized = displayName.trim();
    if (
        Array.from(normalized).length === 0 ||
        Array.from(normalized).length > DISPLAY_NAME_MAX_LENGTH ||
        /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
        throw Object.assign(
            new Error(`Display name must be 1-${DISPLAY_NAME_MAX_LENGTH} characters without control characters.`),
            { code: "INVALID_DISPLAY_NAME" },
        );
    }
    return normalized;
}

function createProfileRepository({
    supabaseUrl = process.env.SUPABASE_URL,
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    createClientFactory = createClient,
} = {}) {
    const configuredUrl = supabaseUrl?.trim();
    const configuredKey = serviceRoleKey?.trim();
    if (!configuredUrl && !configuredKey) {
        return null;
    }
    if (!configuredUrl || !configuredKey) {
        throw new Error(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be configured for profiles."
        );
    }

    const supabase = createClientFactory(configuredUrl, configuredKey, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
        },
    });

    return {
        async getOrCreateProfile(accountId) {
            validateProfileId(accountId);
            const { error: createError } = await supabase
                .from("profiles")
                .upsert(
                    { id: accountId, display_name: DEFAULT_DISPLAY_NAME },
                    { onConflict: "id", ignoreDuplicates: true },
                );
            if (createError) {
                throw createError;
            }

            const { data, error } = await supabase
                .from("profiles")
                .select(PROFILE_FIELDS)
                .eq("id", accountId)
                .single();
            if (error) {
                throw error;
            }
            return data;
        },

        async updateDisplayName(accountId, displayName) {
            validateProfileId(accountId);
            const normalizedName = validateDisplayName(displayName);
            const { data, error } = await supabase
                .from("profiles")
                .update({ display_name: normalizedName })
                .eq("id", accountId)
                .select(PROFILE_FIELDS)
                .single();
            if (error) {
                throw error;
            }
            return data;
        },
    };
}

module.exports = {
    createProfileRepository,
    validateDisplayName,
    validateProfileId,
    DISPLAY_NAME_MAX_LENGTH,
};
