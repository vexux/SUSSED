const assert = require("node:assert/strict");
const test = require("node:test");
const { createSupabaseTokenVerifier } = require("../auth");

test("requires both Supabase URL and publishable key when authentication is configured", () => {
    assert.throws(
        () => createSupabaseTokenVerifier({
            supabaseUrl: "https://project.supabase.co",
            publishableKey: "",
        }),
        /must both be configured/
    );
});

test("verifies tokens through Supabase and returns the verified UUID", async () => {
    const accountId = "55e27c31-6d85-4a12-a0ac-fd8062206372";
    let receivedToken;
    const verify = createSupabaseTokenVerifier({
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "sb_publishable_test",
        createClientFactory(url, key, options) {
            assert.equal(url, "https://project.supabase.co");
            assert.equal(key, "sb_publishable_test");
            assert.deepEqual(options.auth, {
                autoRefreshToken: false,
                detectSessionInUrl: false,
                persistSession: false,
            });
            return {
                auth: {
                    async getUser(token) {
                        receivedToken = token;
                        return { data: { user: { id: accountId } }, error: null };
                    },
                },
            };
        },
    });

    assert.equal(await verify("access-token"), accountId);
    assert.equal(receivedToken, "access-token");
});

test("rejects Supabase verification errors and malformed account IDs", async () => {
    for (const response of [
        { data: { user: null }, error: new Error("expired") },
        { data: { user: { id: "not-a-uuid" } }, error: null },
    ]) {
        const verify = createSupabaseTokenVerifier({
            supabaseUrl: "https://project.supabase.co",
            publishableKey: "sb_publishable_test",
            createClientFactory() {
                return { auth: { async getUser() { return response; } } };
            },
        });
        await assert.rejects(verify("access-token"), /Invalid or expired access token/);
    }
});
