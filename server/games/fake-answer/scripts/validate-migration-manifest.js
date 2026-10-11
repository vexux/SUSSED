const fs = require("node:fs");
const path = require("node:path");
const { validateMigrationManifest } = require("../migrationManifest");

const [manifestFile, canonicalFile, ...extraArgs] = process.argv.slice(2);
if (!manifestFile || !canonicalFile || extraArgs.length > 0) {
    console.error("Usage: npm run validate:migration -- <migration-manifest.json> <canonical-content.json>");
    process.exitCode = 2;
} else {
    const absoluteManifest = path.resolve(manifestFile);
    const absoluteCanonical = path.resolve(canonicalFile);
    let manifest;
    let canonicalContent;
    try {
        manifest = JSON.parse(fs.readFileSync(absoluteManifest, "utf8"));
    } catch (error) {
        console.error(`ERROR: Unable to read migration manifest "${absoluteManifest}": ${error.message}`);
        process.exitCode = 1;
    }
    try {
        canonicalContent = JSON.parse(fs.readFileSync(absoluteCanonical, "utf8"));
    } catch (error) {
        console.error(`ERROR: Unable to read canonical content "${absoluteCanonical}": ${error.message}`);
        process.exitCode = 1;
    }
    if (manifest !== undefined && canonicalContent !== undefined) {
        const result = validateMigrationManifest(manifest, canonicalContent);
        for (const error of result.errors) console.error(`ERROR: ${error}`);
        for (const entry of result.entries) {
            const label = `entries[${entry.index}] ${entry.mapping?.questionId ?? "<invalid>"}`;
            if (entry.errors.length > 0) {
                for (const error of entry.errors) console.error(`ERROR: ${error}`);
            }
            if (entry.differences.length > 0) {
                console.log(`DIFFERENCES: ${label}`);
                for (const difference of entry.differences) {
                    console.log(`  ${difference.field}: legacy=${JSON.stringify(difference.legacy)} generated=${JSON.stringify(difference.generated)}`);
                }
            } else if (entry.valid) {
                console.log(`MATCH: ${label}`);
            }
            if (entry.reviewMetadata) {
                console.log(`REVIEW METADATA: ${label} ${JSON.stringify(entry.reviewMetadata)}`);
            }
        }
        console.log(`Structural validity: ${result.valid ? "passed" : "failed"}; exact legacy match: ${result.matches ? "yes" : "no"}.`);
        console.log("Review metadata is reported separately; unknown rights status is not approval.");
        if (!result.valid || !result.matches) process.exitCode = 1;
    }
}
