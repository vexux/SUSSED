const { createClient } = require("@supabase/supabase-js");

const PROFILE_FIELDS = "id, display_name, handle, handle_changed_at";
const DISPLAY_NAME_MAX_LENGTH = 20;
const HANDLE_MIN_LENGTH = 3;
const HANDLE_MAX_LENGTH = 20;
const DEFAULT_DISPLAY_NAME = "Player";

const ERROR_MESSAGES = {
    INVALID_INPUT: "The supplied profile or social data is invalid.",
    INVALID_DISPLAY_NAME: "Display name must be 2-20 characters.",
    INVALID_HANDLE: "Handle must be 3-20 lowercase letters or numbers.",
    HANDLE_COLLISION: "That handle is already in use.",
    HANDLE_COOLDOWN: "Your handle can only be changed once every 7 days.",
    INVALID_TRANSITION: "That social action is not currently available.",
    INVALID_INPUT: "The supplied profile or social data is invalid.",
    PROFILE_UNAVAILABLE: "Profiles are temporarily unavailable. Guest and room play can continue.",
};

function createProfileError(code, message = ERROR_MESSAGES[code]) {
    return Object.assign(new Error(message || ERROR_MESSAGES.PROFILE_UNAVAILABLE), { code });
}

function validateProfileId(profileId) {
    if (
        typeof profileId !== "string" ||
        Array.from(profileId).length === 0 ||
        Array.from(profileId).length > 128 ||
        /[\u0000-\u001f\u007f]/u.test(profileId)
    ) {
        throw createProfileError("INVALID_INPUT");
    }
}

function validateDisplayName(displayName) {
    if (typeof displayName !== "string") {
        throw createProfileError("INVALID_DISPLAY_NAME");
    }
    const normalized = displayName.trim();
    if (
        Array.from(normalized).length < 2 ||
        Array.from(normalized).length > DISPLAY_NAME_MAX_LENGTH ||
        /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
        throw createProfileError("INVALID_DISPLAY_NAME");
    }
    return normalized;
}

function normalizeHandle(handle) {
    if (typeof handle !== "string") {
        throw createProfileError("INVALID_HANDLE");
    }
    return handle.trim().replace(/^@/u, "").toLowerCase();
}

function validateHandle(handle) {
    const normalized = normalizeHandle(handle);
    if (
        normalized.length < HANDLE_MIN_LENGTH ||
        normalized.length > HANDLE_MAX_LENGTH ||
        !/^[a-z0-9]+$/u.test(normalized)
    ) {
        throw createProfileError("INVALID_HANDLE");
    }
    return normalized;
}

function validateSearch(mode, query) {
    if (mode === "handle") {
        return { mode, query: validateHandle(query) };
    }
    if (
        mode === "displayName" &&
        typeof query === "string" &&
        Array.from(query.trim()).length >= 2 &&
        Array.from(query.trim()).length <= DISPLAY_NAME_MAX_LENGTH &&
        !/[\u0000-\u001f\u007f]/u.test(query)
    ) {
        return { mode, query: query.trim() };
    }
    throw createProfileError("INVALID_INPUT");
}

function mapDatabaseError(error) {
    const code = error && typeof error.code === "string" ? error.code : "";
    const message = error && typeof error.message === "string" ? error.message : "";
    if (["INVALID_INPUT", "INVALID_DISPLAY_NAME", "INVALID_HANDLE", "HANDLE_COLLISION", "HANDLE_COOLDOWN", "INVALID_TRANSITION"].includes(message)) {
        throw createProfileError(message);
    }
    if (code === "23505") {
        throw createProfileError("HANDLE_COLLISION");
    }
    throw createProfileError("PROFILE_UNAVAILABLE");
}

function requireResult(result) {
    if (result && result.error) {
        mapDatabaseError(result.error);
    }
    return result ? result.data : null;
}

function toProfile(row) {
    if (!row) {
        throw createProfileError("PROFILE_UNAVAILABLE");
    }
    const handleChangedAt = row.handle_changed_at || null;
    return {
        displayName: row.display_name,
        handle: row.handle,
        handleChangeAvailableAt: handleChangedAt
            ? new Date(new Date(handleChangedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
    };
}

function firstRow(data) {
    return Array.isArray(data) ? data[0] : data;
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

    async function rpc(name, args) {
        try {
            return requireResult(await supabase.rpc(name, args));
        } catch (error) {
            if (error && ERROR_MESSAGES[error.code]) {
                throw error;
            }
            mapDatabaseError(error);
        }
    }

    async function getProfile(accountId) {
        const data = await rpc("profiles_ensure_handle", { p_account_id: accountId });
        return toProfile(firstRow(data));
    }

    return {
        async getOrCreateProfile(accountId) {
            validateProfileId(accountId);
            let result;
            try {
                result = await supabase.from("profiles").upsert(
                    { id: accountId, display_name: DEFAULT_DISPLAY_NAME },
                    { onConflict: "id", ignoreDuplicates: true },
                );
            } catch (error) {
                mapDatabaseError(error);
            }
            requireResult(result);
            return getProfile(accountId);
        },

        async updateDisplayName(accountId, displayName) {
            validateProfileId(accountId);
            const normalizedName = validateDisplayName(displayName);
            let result;
            try {
                result = await supabase
                    .from("profiles")
                    .update({ display_name: normalizedName })
                    .eq("id", accountId);
            } catch (error) {
                mapDatabaseError(error);
            }
            requireResult(result);
            return getProfile(accountId);
        },

        async updateHandle(accountId, handle) {
            validateProfileId(accountId);
            validateHandle(handle);
            const data = await rpc("profiles_change_handle", {
                p_account_id: accountId,
                p_handle: handle,
            });
            return toProfile(firstRow(data));
        },

        async searchProfiles(accountId, mode, query) {
            validateProfileId(accountId);
            const search = validateSearch(mode, query);
            const data = await rpc("profiles_search_public", {
                p_account_id: accountId,
                p_mode: search.mode,
                p_query: search.query,
            });
            return (data || []).map((profile) => ({
                displayName: profile.display_name,
                handle: profile.handle,
            }));
        },

        async getPublicProfile(accountId, handle) {
            validateProfileId(accountId);
            validateHandle(handle);
            const data = await rpc("profiles_get_public", {
                p_account_id: accountId,
                p_handle: handle,
            });
            const profile = firstRow(data);
            return profile
                ? { displayName: profile.display_name, handle: profile.handle }
                : null;
        },

        async getSocialData(accountId) {
            validateProfileId(accountId);
            const data = await rpc("profiles_get_social_data", { p_account_id: accountId });
            const social = { friends: [], incomingRequests: [], outgoingRequests: [] };
            for (const row of data || []) {
                const item = {
                    displayName: row.display_name,
                    handle: row.handle,
                };
                if (row.kind === "friend") {
                    social.friends.push(item);
                } else if (row.kind === "incoming") {
                    social.incomingRequests.push({ requestId: row.request_id, ...item });
                } else if (row.kind === "outgoing") {
                    social.outgoingRequests.push({ requestId: row.request_id, ...item });
                }
            }
            return social;
        },

        async sendFriendRequest(accountId, handle) {
            validateProfileId(accountId);
            validateHandle(handle);
            const data = await rpc("profiles_send_friend_request", {
                p_account_id: accountId,
                p_handle: handle,
            });
            const row = firstRow(data);
            if (!row || !row.request_id) {
                throw createProfileError("PROFILE_UNAVAILABLE");
            }
            return row.request_id;
        },

        async respondFriendRequest(accountId, requestId, action) {
            validateProfileId(accountId);
            if (
                typeof requestId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId) ||
                !["accept", "decline"].includes(action)
            ) {
                throw createProfileError("INVALID_INPUT");
            }
            await rpc("profiles_respond_friend_request", {
                p_account_id: accountId,
                p_request_id: requestId,
                p_action: action,
            });
        },

        async cancelFriendRequest(accountId, requestId) {
            validateProfileId(accountId);
            if (
                typeof requestId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)
            ) {
                throw createProfileError("INVALID_INPUT");
            }
            await rpc("profiles_cancel_friend_request", {
                p_account_id: accountId,
                p_request_id: requestId,
            });
        },

        async removeFriend(accountId, handle) {
            validateProfileId(accountId);
            validateHandle(handle);
            await rpc("profiles_remove_friend", {
                p_account_id: accountId,
                p_handle: handle,
            });
        },

        async getNotifications(accountId, limit = 20, offset = 0) {
            validateProfileId(accountId);
            if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
                !Number.isInteger(offset) || offset < 0 || offset > 500) {
                throw createProfileError("INVALID_INPUT");
            }
            const result = await rpc("notifications_list", {
                p_account_id: accountId,
                p_limit: limit,
                p_offset: offset,
            });
            if (!result || !Array.isArray(result.notifications) ||
                !Number.isInteger(result.unreadCount) ||
                typeof result.hasMore !== "boolean") {
                throw createProfileError("PROFILE_UNAVAILABLE");
            }
            return result;
        },

        async markNotificationRead(accountId, notificationId) {
            validateProfileId(accountId);
            if (typeof notificationId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(notificationId)) {
                throw createProfileError("INVALID_INPUT");
            }
            await rpc("notifications_mark_read", {
                p_account_id: accountId,
                p_notification_id: notificationId,
            });
        },

        async sendGameInvitation(accountId, handle, roomCode, roomInstanceId) {
            validateProfileId(accountId);
            validateHandle(handle);
            if (typeof roomCode !== "string" || !/^[A-Z]{4}$/u.test(roomCode) ||
                typeof roomInstanceId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(roomInstanceId)) {
                throw createProfileError("INVALID_INPUT");
            }
            const invitationId = await rpc("profiles_send_game_invitation", {
                p_account_id: accountId,
                p_recipient_handle: handle,
                p_room_code: roomCode,
                p_room_instance_id: roomInstanceId,
            });
            if (typeof invitationId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(invitationId)) {
                throw createProfileError("PROFILE_UNAVAILABLE");
            }
            return invitationId;
        },

        async getGameInvitation(accountId, invitationId) {
            validateProfileId(accountId);
            if (typeof invitationId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(invitationId)) {
                throw createProfileError("INVALID_INPUT");
            }
            const row = firstRow(await rpc("profiles_get_game_invitation", {
                p_account_id: accountId,
                p_invitation_id: invitationId,
            }));
            if (!row) return null;
            return {
                invitationId: row.invitation_id,
                roomCode: row.room_code,
                roomInstanceId: row.room_instance_id,
                expiresAt: row.expires_at,
                status: row.status,
            };
        },

        async setGameInvitationStatus(accountId, invitationId, status) {
            validateProfileId(accountId);
            if (typeof invitationId !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(invitationId) ||
                !["accepted", "declined"].includes(status)) {
                throw createProfileError("INVALID_INPUT");
            }
            await rpc("profiles_set_game_invitation_status", {
                p_account_id: accountId,
                p_invitation_id: invitationId,
                p_status: status,
            });
        },
    };
}

module.exports = {
    createProfileRepository,
    validateDisplayName,
    validateHandle,
    normalizeHandle,
    validateProfileId,
    DISPLAY_NAME_MAX_LENGTH,
    HANDLE_MIN_LENGTH,
    HANDLE_MAX_LENGTH,
};
