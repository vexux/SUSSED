const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
    createProfileRepository,
    validateDisplayName,
    validateHandle,
    normalizeHandle,
} = require("../profileRepository");
const { registerProfileHandlers } = require("../profileHandlers");

function createMockSupabase({ failOperation = null } = {}) {
    const profiles = new Map();
    const operations = [];
    const publicProfiles = [];
    const socialRows = [];
    const client = {
        from(table) {
            assert.equal(table, "profiles");
            return {
                async upsert(profile, options) {
                    operations.push(["upsert", profile, options]);
                    if (failOperation === "upsert") {
                        return { error: { message: "database unavailable" } };
                    }
                    if (!profiles.has(profile.id)) {
                        profiles.set(profile.id, { ...profile, handle: null, handle_changed_at: null });
                    }
                    return { error: null };
                },
                update(changes) {
                    operations.push(["update", changes]);
                    return {
                        eq(column, value) {
                            operations.push(["eq", column, value]);
                            if (failOperation === "update") {
                                return Promise.resolve({ error: { message: "database unavailable" } });
                            }
                            Object.assign(profiles.get(value), changes);
                            return Promise.resolve({ error: null });
                        },
                    };
                },
            };
        },
        async rpc(name, args) {
            operations.push(["rpc", name, args]);
            if (failOperation === name || failOperation === "rpc") {
                return { data: null, error: { message: "database unavailable" } };
            }
            const profile = profiles.get(args.p_account_id);
            switch (name) {
                case "profiles_ensure_handle": {
                    if (!profile) {
                        return { data: null, error: { message: "INVALID_INPUT" } };
                    }
                    if (!profile.handle) {
                        profile.handle = `user${String(args.p_account_id).replace(/[^a-z0-9]/giu, "").slice(-12) || "123"}`;
                        profile.handle = profile.handle.slice(0, 20);
                    }
                    return { data: [{
                        display_name: profile.display_name,
                        handle: profile.handle,
                        handle_changed_at: profile.handle_changed_at,
                    }], error: null };
                }
                case "profiles_change_handle":
                    if (failOperation === "collision") {
                        return { data: null, error: { code: "23505", message: "duplicate key" } };
                    }
                    profile.handle = args.p_handle;
                    profile.handle_changed_at = "2026-10-20T00:00:00.000Z";
                    return { data: [{
                        display_name: profile.display_name,
                        handle: profile.handle,
                        handle_changed_at: profile.handle_changed_at,
                    }], error: null };
                case "profiles_search_public":
                    return { data: publicProfiles, error: null };
                case "profiles_get_public":
                    return { data: publicProfiles.filter((item) => item.handle === args.p_handle), error: null };
                case "profiles_get_social_data":
                    return { data: socialRows, error: null };
                case "profiles_send_friend_request":
                    return { data: [{ request_id: "request-uuid" }], error: null };
                case "profiles_respond_friend_request":
                case "profiles_cancel_friend_request":
                case "profiles_remove_friend":
                    return { data: true, error: null };
                default:
                    assert.fail(`Unexpected RPC ${name}`);
            }
        },
    };
    return { client, operations, profiles, publicProfiles, socialRows };
}

function createRepository(mock) {
    return createProfileRepository({
        supabaseUrl: "https://database.example",
        serviceRoleKey: "server-only-test-key",
        createClientFactory(url, key, options) {
            assert.equal(url, "https://database.example");
            assert.equal(key, "server-only-test-key");
            assert.deepEqual(options.auth, {
                autoRefreshToken: false,
                detectSessionInUrl: false,
                persistSession: false,
            });
            return mock.client;
        },
    });
}

function createFakeSocket(accountId) {
    const handlers = new Map();
    return {
        data: accountId ? { accountId } : {},
        on(event, handler) {
            handlers.set(event, handler);
        },
        async emit(event, ...args) {
            const handler = handlers.get(event);
            assert.ok(handler, `missing handler for ${event}`);
            return new Promise((resolve) => {
                const acknowledge = (response) => resolve(response);
                if (event === "get-profile" || event === "get-social-data") {
                    handler(acknowledge);
                } else {
                    handler(args[0], acknowledge);
                }
            });
        },
    };
}

test("creates an idempotent profile and returns only client-safe profile fields", async () => {
    const mock = createMockSupabase();
    const repository = createRepository(mock);
    const uid = "firebase:user-with_custom-id.42";
    const profiles = await Promise.all([
        repository.getOrCreateProfile(uid),
        repository.getOrCreateProfile(uid),
    ]);

    assert.equal(profiles.length, 2);
    assert.equal(profiles[0].displayName, "Player");
    assert.match(profiles[0].handle, /^[a-z0-9]{3,20}$/u);
    assert.equal(profiles[0].handleChangeAvailableAt, null);
    assert.equal(Object.hasOwn(profiles[0], "id"), false);
    assert.equal(mock.profiles.size, 1);
    assert.deepEqual(mock.operations[0], [
        "upsert",
        { id: uid, display_name: "Player" },
        { onConflict: "id", ignoreDuplicates: true },
    ]);
});

test("profile repository is optional when unconfigured and rejects partial credentials", () => {
    assert.equal(createProfileRepository({ supabaseUrl: "", serviceRoleKey: "" }), null);
    assert.throws(
        () => createProfileRepository({ supabaseUrl: "https://database.example", serviceRoleKey: "" }),
        /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be configured/,
    );
});

test("display names and handles enforce normalized public rules", () => {
    assert.equal(validateDisplayName("  Alex  "), "Alex");
    assert.equal(validateHandle("alex42"), "alex42");
    assert.equal(validateHandle(" @Alex42 "), "alex42");
    assert.equal(normalizeHandle(" @MixedCase "), "mixedcase");
    for (const invalidName of ["", " ", "A", "x".repeat(21), "Name\nInjected"]) {
        assert.throws(() => validateDisplayName(invalidName), { code: "INVALID_DISPLAY_NAME" });
    }
    for (const invalidHandle of ["ab", "has-space", "x".repeat(21)]) {
        assert.throws(() => validateHandle(invalidHandle), { code: "INVALID_HANDLE" });
    }
});

test("display-name update is trimmed and response omits Firebase ID", async () => {
    const mock = createMockSupabase();
    const repository = createRepository(mock);
    await repository.getOrCreateProfile("account-123");
    const result = await repository.updateDisplayName("account-123", "  New Name  ");
    assert.equal(mock.profiles.get("account-123").display_name, "New Name");
    assert.equal(result.displayName, "New Name");
    assert.equal(Object.hasOwn(result, "id"), false);
});

test("profile writes use RPC for handle cooldown and translate handle collisions safely", async () => {
    const mock = createMockSupabase();
    mock.profiles.set("account-1", { id: "account-1", display_name: "Player", handle: "player1", handle_changed_at: null });
    const repository = createRepository(mock);
    const result = await repository.updateHandle("account-1", "newhandle");
    const changeCall = mock.operations.find((row) => row[0] === "rpc");
    assert.deepEqual(changeCall, [
        "rpc",
        "profiles_change_handle",
        { p_account_id: "account-1", p_handle: "newhandle" },
    ]);
    assert.equal(result.handle, "newhandle");
    assert.equal(result.handleChangeAvailableAt, "2026-10-27T00:00:00.000Z");
    assert.deepEqual(mock.operations.find((row) => row[0] === "rpc"), [
        "rpc",
        "profiles_change_handle",
        { p_account_id: "account-1", p_handle: "newhandle" },
    ]);

    const collisionMock = createMockSupabase({ failOperation: "collision" });
    collisionMock.profiles.set("account-1", { id: "account-1", display_name: "Player", handle: null });
    await assert.rejects(
        createRepository(collisionMock).updateHandle("account-1", "newhandle"),
        { code: "HANDLE_COLLISION" },
    );
});

test("public search, profile lookup, and social lists contain only the agreed public fields", async () => {
    const mock = createMockSupabase();
    mock.publicProfiles.push({ display_name: "Alex", handle: "alex123" });
    mock.socialRows.push(
        { kind: "friend", request_id: null, display_name: "Friend", handle: "friend1" },
        { kind: "incoming", request_id: "request-1", display_name: "Incoming", handle: "incoming1" },
        { kind: "outgoing", request_id: "request-2", display_name: "Outgoing", handle: "outgoing1" },
    );
    const repository = createRepository(mock);
    assert.deepEqual(await repository.searchProfiles("me", "handle", "alex123"), [
        { displayName: "Alex", handle: "alex123" },
    ]);
    assert.deepEqual(await repository.getPublicProfile("me", "alex123"), {
        displayName: "Alex",
        handle: "alex123",
    });
    assert.deepEqual(await repository.getSocialData("me"), {
        friends: [{ displayName: "Friend", handle: "friend1" }],
        incomingRequests: [{ requestId: "request-1", displayName: "Incoming", handle: "incoming1" }],
        outgoingRequests: [{ requestId: "request-2", displayName: "Outgoing", handle: "outgoing1" }],
    });
    assert.deepEqual(mock.operations.filter((row) => row[0] === "rpc").slice(0, 2), [
        ["rpc", "profiles_search_public", { p_account_id: "me", p_mode: "handle", p_query: "alex123" }],
        ["rpc", "profiles_get_public", { p_account_id: "me", p_handle: "alex123" }],
    ]);
});

test("social repository mutations call atomic RPCs with the verified account", async () => {
    const mock = createMockSupabase();
    const repository = createRepository(mock);
    assert.equal(await repository.sendFriendRequest("verified-id", "friend1"), "request-uuid");
    await repository.respondFriendRequest("verified-id", "11111111-1111-4111-8111-111111111111", "accept");
    await repository.cancelFriendRequest("verified-id", "11111111-1111-4111-8111-111111111111");
    await repository.removeFriend("verified-id", "friend1");
    assert.deepEqual(mock.operations.filter((row) => row[0] === "rpc").map((row) => row[1]), [
        "profiles_send_friend_request",
        "profiles_respond_friend_request",
        "profiles_cancel_friend_request",
        "profiles_remove_friend",
    ]);
    assert.ok(mock.operations.filter((row) => row[0] === "rpc").every((row) => row[2].p_account_id === "verified-id"));
});

test("Socket.IO profile and social events use socket.data.accountId and exact ack shapes", async () => {
    const mock = createMockSupabase();
    const repository = createRepository(mock);
    const socket = createFakeSocket("verified-firebase-uid");
    registerProfileHandlers(socket, repository, () => {});

    assert.deepEqual(await socket.emit("get-profile"), {
        profile: { displayName: "Player", handle: "userdfirebaseuid", handleChangeAvailableAt: null },
    });
    assert.deepEqual(await socket.emit("update-profile-display-name", {
        displayName: "My Name",
        accountId: "client-victim",
    }), {
        profile: { displayName: "My Name", handle: "userdfirebaseuid", handleChangeAvailableAt: null },
    });
    assert.deepEqual(await socket.emit("update-profile-handle", {
        handle: "newhandle",
        accountId: "client-victim",
    }), {
        profile: {
            displayName: "My Name",
            handle: "newhandle",
            handleChangeAvailableAt: "2026-10-27T00:00:00.000Z",
        },
    });
    assert.deepEqual(await socket.emit("search-profiles", {
        mode: "handle",
        query: "alex123",
        accountId: "client-victim",
    }), { profiles: [] });
    assert.deepEqual(await socket.emit("get-public-profile", { handle: "alex123" }), { profile: null });
    assert.deepEqual(await socket.emit("get-social-data"), {
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
    });
    assert.deepEqual(await socket.emit("send-friend-request", { handle: "friend1" }), { requestId: "request-uuid" });
    assert.deepEqual(await socket.emit("respond-friend-request", {
        action: "accept",
        requestId: "11111111-1111-4111-8111-111111111111",
    }), { ok: true });
    assert.deepEqual(await socket.emit("cancel-friend-request", {
        requestId: "11111111-1111-4111-8111-111111111111",
    }), { ok: true });
    assert.deepEqual(await socket.emit("remove-friend", { handle: "friend1" }), { ok: true });
    assert.equal(mock.profiles.has("client-victim"), false);
    assert.ok(mock.operations.filter((row) => row[0] === "rpc").every((row) => row[2].p_account_id === "verified-firebase-uid"));
});

test("guest and unavailable repository requests return controlled acknowledgements", async () => {
    let calls = 0;
    const repository = { async getOrCreateProfile() { calls += 1; } };
    const socket = createFakeSocket(null);
    registerProfileHandlers(socket, repository, () => {});
    assert.equal((await socket.emit("get-profile")).error.code, "AUTH_REQUIRED");
    assert.equal(calls, 0);

    const unavailable = createFakeSocket("signed-in");
    registerProfileHandlers(unavailable, null);
    assert.deepEqual((await unavailable.emit("get-profile")).error, {
        code: "PROFILE_UNAVAILABLE",
        message: "Profiles are temporarily unavailable. Guest and room play can continue.",
    });
});

test("invalid input, cooldown, invalid transitions, and database outages have stable error codes", async () => {
    const mock = createMockSupabase({ failOperation: "profiles_change_handle" });
    mock.profiles.set("account-1", { id: "account-1", display_name: "Player", handle: "player1", handle_changed_at: null });
    const repository = createRepository(mock);
    const socket = createFakeSocket("account-1");
    registerProfileHandlers(socket, repository, () => {});

    assert.equal((await socket.emit("update-profile-handle", { handle: "Bad Name" })).error.code, "INVALID_HANDLE");
    assert.equal((await socket.emit("update-profile-handle", { handle: "newhandle" })).error.code, "PROFILE_UNAVAILABLE");

    const errorMock = createMockSupabase();
    errorMock.profiles.set("account-1", { id: "account-1", display_name: "Player", handle: "player1", handle_changed_at: null });
    const errorRepository = createRepository(errorMock);
    errorMock.client.rpc = async () => ({ data: null, error: { message: "HANDLE_COOLDOWN" } });
    await assert.rejects(errorRepository.updateHandle("account-1", "newhandle"), { code: "HANDLE_COOLDOWN" });
    errorMock.client.rpc = async () => ({ data: null, error: { message: "INVALID_TRANSITION" } });
    await assert.rejects(errorRepository.respondFriendRequest(
        "account-1",
        "11111111-1111-4111-8111-111111111111",
        "accept",
    ), { code: "INVALID_TRANSITION" });
});

test("phase 2 migration is additive, server-only, and defines handles and atomic social RPCs", () => {
    const migration = fs.readFileSync(
        path.join(__dirname, "../../supabase/migrations/202610260002_profiles_handles_friends.sql"),
        "utf8",
    );
    assert.match(migration, /add column if not exists handle text/i);
    assert.match(migration, /profiles_handle_unique_idx/i);
    assert.match(migration, /\^\[a-z0-9\]\{3,20\}\$/i);
    assert.match(migration, /interval '7 days'/i);
    assert.match(migration, /profiles_ensure_handle/i);
    assert.match(migration, /profiles_change_handle/i);
    assert.match(migration, /pg_advisory_xact_lock/i);
    assert.match(migration, /friend_requests_one_pending_per_pair_idx/i);
    assert.match(migration, /v_recipient_id = p_account_id/i);
    assert.match(migration, /p_action not in \('accept', 'decline'\)/i);
    assert.match(migration, /v_request\.recipient_id <> p_account_id/i);
    assert.match(migration, /v_request\.requester_id <> p_account_id/i);
    assert.match(migration, /where f\.user_low = v_low and f\.user_high = v_high/i);
    assert.match(migration, /enable row level security/i);
    assert.match(migration, /grant execute on function public\.profiles_send_friend_request.*to service_role/is);
    assert.match(migration, /grant execute on function public\.profiles_respond_friend_request.*to service_role/is);
    assert.doesNotMatch(migration, /drop table|truncate table/i);
    assert.equal(fs.existsSync(path.join(__dirname, "../../supabase/migrations/202610260001_profiles.sql")), true);
});
