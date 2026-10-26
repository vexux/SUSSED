const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
    createProfileRepository,
    validateDisplayName,
} = require("../profileRepository");
const { registerProfileHandlers } = require("../profileHandlers");

function createMockSupabase({ failOperation = null } = {}) {
    const profiles = new Map();
    const operations = [];

    const client = {
        from(table) {
            assert.equal(table, "profiles");
            return {
                async upsert(profile, options) {
                    operations.push(["upsert", profile, options]);
                    if (failOperation === "upsert") {
                        return { error: new Error("database unavailable") };
                    }
                    if (!profiles.has(profile.id)) {
                        profiles.set(profile.id, {
                            ...profile,
                            created_at: "2026-01-01T00:00:00.000Z",
                            updated_at: "2026-01-01T00:00:00.000Z",
                        });
                    }
                    return { error: null };
                },
                select(fields) {
                    operations.push(["select", fields]);
                    return {
                        eq(column, value) {
                            operations.push(["eq", column, value]);
                            return {
                                async single() {
                                    if (failOperation === "select") {
                                        return { data: null, error: new Error("database unavailable") };
                                    }
                                    return {
                                        data: profiles.get(value) ?? null,
                                        error: profiles.has(value) ? null : new Error("profile missing"),
                                    };
                                },
                            };
                        },
                    };
                },
                update(changes) {
                    operations.push(["update", changes]);
                    return {
                        eq(column, value) {
                            operations.push(["eq", column, value]);
                            return {
                                select(fields) {
                                    operations.push(["select", fields]);
                                    return {
                                        async single() {
                                            if (failOperation === "update") {
                                                return { data: null, error: new Error("database unavailable") };
                                            }
                                            const profile = profiles.get(value);
                                            if (!profile) {
                                                return { data: null, error: new Error("profile missing") };
                                            }
                                            Object.assign(profile, changes);
                                            return { data: profile, error: null };
                                        },
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    };

    return { client, operations, profiles };
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
                if (event === "update-profile-display-name") {
                    handler(args[0], acknowledge);
                } else {
                    handler(acknowledge);
                }
            });
        },
    };
}

test("creates a profile with a Firebase UID stored unchanged as a text identifier", async () => {
    const mock = createMockSupabase();
    const repository = createRepository(mock);
    const firebaseUid = "firebase:user-with_custom-id.42";
    const profile = await repository.getOrCreateProfile(firebaseUid);

    assert.equal(profile.id, firebaseUid);
    assert.equal(profile.display_name, "Player");
    assert.deepEqual(mock.operations[0], [
        "upsert",
        { id: firebaseUid, display_name: "Player" },
        { onConflict: "id", ignoreDuplicates: true },
    ]);
    assert.equal(
        mock.operations.find(([operation]) => operation === "select")[1],
        "id, display_name",
    );
});

test("profile repository is optional when unconfigured and rejects partial credentials", () => {
    assert.equal(
        createProfileRepository({
            supabaseUrl: "",
            serviceRoleKey: "",
        }),
        null,
    );
    assert.throws(
        () => createProfileRepository({
            supabaseUrl: "https://database.example",
            serviceRoleKey: "",
        }),
        /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be configured/,
    );
});

test("returns existing profile without overwriting user-edited display name", async () => {
    const mock = createMockSupabase();
    mock.profiles.set("existing-uid", {
        id: "existing-uid",
        display_name: "Saved Name",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
    });
    const repository = createRepository(mock);

    const profile = await repository.getOrCreateProfile("existing-uid");
    assert.equal(profile.display_name, "Saved Name");
    assert.equal(mock.profiles.get("existing-uid").display_name, "Saved Name");
});

test("concurrent profile creation is idempotent and preserves the single profile", async () => {
    const mock = createMockSupabase();
    const repository = createRepository(mock);

    const profiles = await Promise.all([
        repository.getOrCreateProfile("parallel-uid"),
        repository.getOrCreateProfile("parallel-uid"),
    ]);
    assert.equal(profiles.length, 2);
    assert.deepEqual(profiles[0], profiles[1]);
    assert.equal(mock.profiles.size, 1);
});

test("display names are trimmed and constrained", () => {
    assert.equal(validateDisplayName("  Alex  "), "Alex");
    for (const invalidName of ["", "  ", "x".repeat(33), "Name\nInjected"]) {
        assert.throws(
            () => validateDisplayName(invalidName),
            { code: "INVALID_DISPLAY_NAME" },
        );
    }
});

test("profile operations use the verified socket account, not a client-supplied UID", async () => {
    const mock = createMockSupabase();
    const repository = createRepository(mock);
    const socket = createFakeSocket("verified-firebase-uid");
    registerProfileHandlers(socket, repository, () => {});

    const fetched = await socket.emit("get-profile");
    assert.equal(fetched.profile.id, "verified-firebase-uid");

    const updated = await socket.emit("update-profile-display-name", {
        displayName: "My Name",
        accountId: "some-other-users-uid",
    });
    assert.equal(updated.profile.id, "verified-firebase-uid");
    assert.equal(updated.profile.display_name, "My Name");
    assert.equal(mock.profiles.has("some-other-users-uid"), false);
});

test("guest profile requests are rejected without contacting Supabase", async () => {
    let repositoryCalls = 0;
    const repository = {
        async getOrCreateProfile() {
            repositoryCalls += 1;
        },
        async updateDisplayName() {
            repositoryCalls += 1;
        },
    };
    const socket = createFakeSocket(null);
    registerProfileHandlers(socket, repository, () => {});

    const response = await socket.emit("get-profile");
    assert.equal(response.error.code, "AUTH_REQUIRED");
    assert.equal(repositoryCalls, 0);
});

test("authenticated profile requests report unavailable storage without throwing", async () => {
    const socket = createFakeSocket("account-uid");
    registerProfileHandlers(socket, null);

    const response = await socket.emit("get-profile");
    assert.equal(response.error.code, "PROFILE_UNAVAILABLE");
});

test("database failures return a controlled profile error and are reported safely", async () => {
    const mock = createMockSupabase({ failOperation: "upsert" });
    const repository = createRepository(mock);
    const reported = [];
    const socket = createFakeSocket("account-uid");
    registerProfileHandlers(socket, repository, (code) => reported.push(code));

    const response = await socket.emit("get-profile");
    assert.equal(response.error.code, "PROFILE_UNAVAILABLE");
    assert.deepEqual(reported, ["unknown"]);
});

test("migration defines text Firebase IDs, timestamp maintenance, and server-only access", () => {
    const migration = fs.readFileSync(
        path.join(__dirname, "../../supabase/migrations/202610260001_profiles.sql"),
        "utf8",
    );
    assert.match(migration, /id text primary key/i);
    assert.match(migration, /created_at timestamptz not null default now\(\)/i);
    assert.match(migration, /profiles_set_updated_at/i);
    assert.match(migration, /enable row level security/i);
    assert.match(migration, /revoke all on table public\.profiles from anon, authenticated/i);
    assert.match(migration, /grant all on table public\.profiles to service_role/i);
    assert.doesNotMatch(migration, /drop table|truncate table/i);
});
