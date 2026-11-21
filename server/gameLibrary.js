const registry = require("./gameRegistry");
const { RoomError } = require("./roomManager");

// This adapter deliberately lasts only for the life of one server process.
function createMemoryGrantStore() {
    const grants = new Map();
    return {
        get: id => grants.get(id),
        save: record => grants.set(record.grantId, Object.freeze(record)),
        active(accountId) {
            return [...grants.values()].filter(r => r.accountId === accountId && r.active);
        }
    };
}

function createGameLibrary(config = {}, store = createMemoryGrantStore()) {
    if (!config || typeof config !== "object" || Array.isArray(config) ||
        Object.keys(config).some(key => !["games", "bundles"].includes(key)) ||
        ["games", "bundles"].some(key => key in config && !Array.isArray(config[key]))) {
        throw new TypeError("Invalid catalogue configuration");
    }
    const games = new Map();
    const bundles = new Map();
    const prices = new Map();
    const listeners = new Set();
    const slug = value => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
    function registerPrices(id, regions = {}) {
        if (!regions || typeof regions !== "object" || Array.isArray(regions)) throw new TypeError("Invalid price configuration");
        const entries = new Map();
        for (const [region, price] of Object.entries(regions)) {
            if (!/^(default|[A-Z]{2})$/.test(region) || !/^[A-Z]{3}$/.test(price?.currency) ||
                !Number.isSafeInteger(price.amountMinor) || price.amountMinor < 0) throw new TypeError("Invalid regional price");
            entries.set(region, Object.freeze({ currency: price.currency, amountMinor: price.amountMinor }));
        }
        prices.set(id, entries);
    }
    for (const entry of config.games ?? []) {
        if (!registry.get(entry.id) || games.has(entry.id) || !["free", "premium"].includes(entry.access) ||
            (entry.available !== undefined && typeof entry.available !== "boolean") ||
            (entry.order !== undefined && !Number.isSafeInteger(entry.order)) ||
            (entry.artwork !== undefined && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(png|webp|jpg)$/.test(entry.artwork))) throw new TypeError("Invalid catalogue game");
        registerPrices(entry.id, entry.prices);
        games.set(entry.id, Object.freeze({ ...entry }));
    }
    for (const bundle of config.bundles ?? []) {
        if (!slug(bundle.id) || registry.get(bundle.id) || bundles.has(bundle.id) || !Array.isArray(bundle.games) ||
            !bundle.games.length || new Set(bundle.games).size !== bundle.games.length ||
            !bundle.games.every(id => games.get(id)?.access === "premium")) throw new TypeError("Invalid catalogue bundle");
        registerPrices(bundle.id, bundle.prices);
        bundles.set(bundle.id, Object.freeze([...bundle.games]));
    }

    // Caller authenticates provider/admin events. Each independent grant has a
    // stable key and strictly increasing version, including refund tombstones.
    function applyGrant({ grantId, version, accountId, kind, productId, source, active, transactionRef = null }) {
        if (![grantId, accountId, source].every(v => typeof v === "string" && v.trim()) ||
            !Number.isSafeInteger(version) || version < 1 || typeof active !== "boolean" ||
            (transactionRef !== null && typeof transactionRef !== "string") ||
            !(kind === "game" ? games.get(productId)?.access === "premium" : kind === "bundle" && bundles.has(productId))) throw new TypeError("Invalid entitlement");
        const old = store.get(grantId);
        if (old && (old.accountId !== accountId || old.kind !== kind || old.productId !== productId || old.source !== source)) throw new Error("Grant identity mismatch");
        if (old && old.version >= version) return false;
        const updatedAt = new Date().toISOString();
        store.save({ grantId, version, accountId, kind, productId, source, active, transactionRef,
            createdAt: old?.createdAt ?? updatedAt, updatedAt });
        for (const listener of listeners) listener(accountId);
        return true;
    }
    function list(accountId) {
        const owned = accountId ? store.active(accountId) : [];
        return registry.list().map((game, index) => {
            const policy = games.get(game.id);
            const access = policy?.access ?? "free";
            const available = policy?.available !== false;
            const bundleIds = [...bundles].filter(([, ids]) => ids.includes(game.id)).map(([id]) => id);
            const canSelect = available && (access === "free" || owned.some(r =>
                r.kind === "game" ? r.productId === game.id : bundleIds.includes(r.productId)));
            return { ...game, access, available, bundleIds, canSelect, order: policy?.order ?? index,
                ...(policy?.artwork ? { artwork: policy.artwork } : {}) };
        }).sort((a,b) => a.order - b.order);
    }
    function authorize(accountId, id) {
        const entry = list(accountId).find(g => g.id === id);
        if (!entry) throw new RoomError("GAME_NOT_FOUND", "That game is not available.");
        if (!entry.available) throw new RoomError("GAME_UNAVAILABLE", "This game is currently unavailable.");
        if (!entry.canSelect) throw new RoomError("HOST_ACCESS_REQUIRED", "The host needs access to this premium game.");
    }
    function setAvailability(id, available) {
        if (!registry.get(id) || typeof available !== "boolean") throw new TypeError("Invalid availability");
        games.set(id, { ...games.get(id), available });
        for (const listener of listeners) listener(null);
    }
    function onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
    function getPrice(id, region) {
        const entries = prices.get(id);
        return entries?.get(region) ?? entries?.get("default") ?? null;
    }
    return { list, authorize, applyGrant, setAvailability, onChange, getPrice };
}

module.exports = { createMemoryGrantStore, createGameLibrary };
