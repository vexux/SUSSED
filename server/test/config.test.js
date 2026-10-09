const assert = require("node:assert/strict");
const test = require("node:test");
const { isOriginAllowed, resolveAllowedOrigins } = require("../config");

test("allows configured frontend origins in production without development defaults", () => {
    const origins = resolveAllowedOrigins({
        nodeEnv: "production",
        clientOrigin: "https://game.example,https://preview.example/",
    });
    assert.deepEqual(origins, ["https://game.example", "https://preview.example"]);
    assert.equal(
        isOriginAllowed("https://game.example", { nodeEnv: "production", origins }),
        true
    );
    assert.equal(
        isOriginAllowed("https://unlisted.example", { nodeEnv: "production", origins }),
        false
    );
    assert.equal(
        isOriginAllowed("http://localhost:5173", { nodeEnv: "production", origins }),
        false
    );
});

test("requires an explicit frontend origin in production", () => {
    assert.throws(
        () => resolveAllowedOrigins({ nodeEnv: "production", clientOrigin: "" }),
        /CLIENT_ORIGIN is required in production/
    );
});

test("rejects CLIENT_ORIGIN values that are not origins", () => {
    assert.throws(
        () =>
            resolveAllowedOrigins({
                nodeEnv: "production",
                clientOrigin: "https://game.example/app",
            }),
        /without credentials, paths, queries, or fragments/
    );
});

test("allows localhost origins during development and rejects unconfigured remote origins", () => {
    assert.equal(isOriginAllowed("http://localhost:5174"), true);
    assert.equal(isOriginAllowed("http://127.0.0.1:4173"), true);
    assert.equal(isOriginAllowed("https://unexpected.example"), false);
    assert.equal(isOriginAllowed(undefined), true);
});
