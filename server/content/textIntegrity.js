const { TextDecoder } = require("node:util");

const suspiciousPatterns = [
    /\uFFFD/u,
    /Ã(?:©|¨|­|®|¯|±|²|³|´|µ|¶|·|¸|¹|º|»|¼|½|¾|¿)/u,
    /Â(?:\s|\u00A0|°|©|®|™|²|³)/u,
    /â€(?:™|œ|“|”|–|—|˜|¦|¡|¢|£|¤|¥|¨|©|ª|¬|®|¯)/u,
    /ðŸ[\u0080-\uFFFF]/u,
    /ï¿½/u,
    /\b[\p{L}\p{N}]+\?(?:s|t|re|ve|ll|d|m)\b/iu,
];

function decodeUtf8(buffer, fileName = "<input>") {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
        throw new Error(`${fileName}: invalid UTF-8 byte sequence.`);
    }
}

function findTextIntegrityIssues(value) {
    if (typeof value !== "string") return [];
    const issues = [];
    for (const pattern of suspiciousPatterns) {
        for (const match of value.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
            if (!issues.some(({ substring }) => substring === match[0])) {
                issues.push({ substring: match[0] });
            }
        }
    }
    return issues;
}

module.exports = { decodeUtf8, findTextIntegrityIssues };
