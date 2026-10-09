const DEFAULT_PORT = 3000;
const configuredPort = process.env.PORT;

let port = DEFAULT_PORT;
if (configuredPort !== undefined) {
    port = configuredPort.trim() === "" ? Number.NaN : Number(configuredPort);
}

if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError("PORT must be an integer between 0 and 65535.");
}

function parseClientOrigins(value) {
    if (value === undefined || value.trim() === "") {
        return [];
    }

    return value.split(",").map((entry) => {
        const candidate = entry.trim();
        let url;
        try {
            url = new URL(candidate);
        } catch {
            throw new Error(
                "CLIENT_ORIGIN must contain comma-separated HTTP(S) origins, for example https://example.com."
            );
        }

        if (
            !["http:", "https:"].includes(url.protocol) ||
            url.origin === "null" ||
            url.username !== "" ||
            url.password !== "" ||
            (url.pathname !== "" && url.pathname !== "/") ||
            url.search !== "" ||
            url.hash !== ""
        ) {
            throw new Error(
                "CLIENT_ORIGIN entries must be HTTP(S) origins without credentials, paths, queries, or fragments."
            );
        }

        return url.origin;
    });
}

function resolveAllowedOrigins({
    nodeEnv = process.env.NODE_ENV,
    clientOrigin = process.env.CLIENT_ORIGIN,
} = {}) {
    const origins = parseClientOrigins(clientOrigin);
    if (nodeEnv === "production" && origins.length === 0) {
        throw new Error(
            "CLIENT_ORIGIN is required in production and must list at least one frontend origin."
        );
    }
    return [...new Set(origins)];
}

const allowedOrigins = resolveAllowedOrigins();

function isOriginAllowed(
    origin,
    { nodeEnv = process.env.NODE_ENV, origins = allowedOrigins } = {}
) {
    if (!origin || origins.includes(origin)) {
        return true;
    }
    if (nodeEnv === "production") {
        return false;
    }

    try {
        const url = new URL(origin);
        return (
            url.protocol === "http:" &&
            url.origin === origin &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        );
    } catch {
        return false;
    }
}

module.exports = {
    allowedOrigins,
    isOriginAllowed,
    port,
    resolveAllowedOrigins,
};
