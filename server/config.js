const DEFAULT_PORT = 3000;
const configuredPort = process.env.PORT;

const port =
    configuredPort === undefined ? DEFAULT_PORT : Number(configuredPort);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError("PORT must be an integer between 0 and 65535.");
}

module.exports = { port };
