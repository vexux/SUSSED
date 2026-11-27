const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { buildGeneralTopicLedgerUpdate, deriveRecord } = require("./generalTopicLedgerPreview");

function writeLedgerAtomically(ledgerPath, ledger, fileSystem = fs) {
    const temporaryPath = path.join(path.dirname(ledgerPath), `.${path.basename(ledgerPath)}.${randomUUID()}.tmp`);
    let descriptor;
    try {
        descriptor = fileSystem.openSync(temporaryPath, "wx", 0o600);
        fileSystem.writeFileSync(descriptor, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
        fileSystem.fsyncSync(descriptor);
        fileSystem.closeSync(descriptor);
        descriptor = undefined;
        fileSystem.renameSync(temporaryPath, ledgerPath);
    } catch (error) {
        if (descriptor !== undefined) {
            try { fileSystem.closeSync(descriptor); } catch {}
        }
        try {
            if (fileSystem.existsSync(temporaryPath)) fileSystem.unlinkSync(temporaryPath);
        } catch (cleanupError) {
            throw new Error(`Ledger update failed (${error.message}); temporary-file cleanup failed (${cleanupError.message}).`);
        }
        throw new Error(`Could not atomically update ledger ${ledgerPath}: ${error.message}`);
    }
}

module.exports = { buildGeneralTopicLedgerUpdate, deriveRecord, writeLedgerAtomically };
