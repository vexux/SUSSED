const test = require("node:test");
const assert = require("node:assert/strict");
const { createGameLibrary, createMemoryGrantStore } = require("../gameLibrary");
const config = require("../catalogue.example.json");

test("catalogue validates policy and projects public game metadata", () => {
    for (const games of [[{ id: "unknown", access: "free" }], [config.games[0], config.games[0]], [{ id: "bruh-wtf", access: "subscription" }]]) {
        assert.throws(() => createGameLibrary({ games }));
    }
    assert.throws(() => createGameLibrary({ bundles: config.bundles }));
    const library = createGameLibrary(config);
    assert.equal(library.list(null)[0].canSelect, true);
    assert.deepEqual(library.list(null)[2].bundleIds, ["party-pack"]);
    assert.throws(() => library.authorize(null, "missing"), { code: "GAME_NOT_FOUND" });
    library.setAvailability("fact-or-cap", false);
    assert.throws(() => library.authorize(null, "fact-or-cap"), { code: "GAME_UNAVAILABLE" });
});

test("versioned grants isolate accounts and preserve independent rights across refunds", () => {
    const store = createMemoryGrantStore();
    const library = createGameLibrary(config, store);
    const individual = { grantId: "g", accountId: "owner", version: 1, kind: "game", productId: "bruh-wtf", active: true, source: "promotion" };
    const bundle = { ...individual, grantId: "b", kind: "bundle", productId: "party-pack", source: "admin" };
    assert.equal(library.applyGrant(individual), true);
    assert.equal(library.applyGrant(individual), false);
    library.applyGrant(bundle);
    library.applyGrant({ ...bundle, version: 2, active: false });
    assert.equal(library.applyGrant(bundle), false);
    library.authorize("owner", "bruh-wtf");
    assert.throws(() => library.authorize("owner", "fact-or-cap-anime"), { code: "HOST_ACCESS_REQUIRED" });
    assert.throws(() => library.authorize("another", "bruh-wtf"), { code: "HOST_ACCESS_REQUIRED" });
    assert.throws(() => library.applyGrant({ ...individual, accountId: "another" }));
    assert.ok(store.get("b").updatedAt);
});

test("regional prices use minor units and only fall back to a configured default", () => {
    const game = { id: "bruh-wtf", access: "premium", prices: {
        default: { currency: "USD", amountMinor: 100 }, IN: { currency: "INR", amountMinor: 7900 }
    } };
    const library = createGameLibrary({ games: [game] });
    assert.deepEqual(library.getPrice(game.id, "IN"), game.prices.IN);
    assert.deepEqual(library.getPrice(game.id, "GB"), game.prices.default);
    assert.equal(library.getPrice("fact-or-cap", "IN"), null);
});
