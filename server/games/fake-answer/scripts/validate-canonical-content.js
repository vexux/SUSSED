const fs = require("node:fs");
const path = require("node:path");
const { validateCanonicalContent } = require("../canonicalContent");

const inputFile = process.argv[2];
if (!inputFile) {
    console.error("Usage: npm run validate:canonical -- <canonical-content.json>");
    process.exitCode = 2;
} else {
    const absolutePath = path.resolve(inputFile);
    let data;
    try {
        data = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    } catch (error) {
        console.error(`ERROR: Unable to read canonical content "${absolutePath}": ${error.message}`);
        process.exitCode = 1;
    }
    if (data !== undefined) {
        const result = validateCanonicalContent(data, path.relative(process.cwd(), absolutePath));
        if (result.errors.length > 0) {
            for (const error of result.errors) console.error(`ERROR: ${error}`);
            process.exitCode = 1;
        } else {
            console.log(`Validated canonical content ${absolutePath}; structural checks passed.`);
        }
    }
}
