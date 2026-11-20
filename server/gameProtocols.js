const registry = require("./gameRegistry");
const protocols = new Map([
    ["fact-or-cap", require("./games/fact-or-cap/socketHandlers")],
    ["bruh-wtf", require("./games/bruh-wtf/socketHandlers")]
]);

function get(gameId) {
    return protocols.get(registry.get(gameId)?.socketProtocol);
}

function registerSocketHandlers(io, socket) {
    for (const protocol of protocols.values()) protocol.registerSocketHandlers(io, socket);
}

module.exports = { get, registerSocketHandlers };
