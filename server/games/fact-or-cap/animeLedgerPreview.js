const path = require("node:path");
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/u;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function makeAnimeLedgerUpdate(ledger, manifest, pack, existingPacks) {
    const errors = [];
    if (!isRecord(ledger) || ledger.ledgerVersion !== 1 || !Array.isArray(ledger.franchises) || !isRecord(ledger.bankSnapshot)) {
        return { valid: false, errors: ["Anime franchise ledger has an unsupported or malformed version-1 structure."], updatedLedger: null };
    }
    if (!isRecord(manifest) || manifest.manifestVersion !== 1 || !Array.isArray(manifest.entries) || !Array.isArray(manifest.franchises ?? [])) {
        return { valid: false, errors: ["Anime franchise manifest requires manifestVersion 1, franchises, and entries arrays."], updatedLedger: null };
    }
    const known = new Map();
    const membership = new Map();
    const aliases = new Map();
    const actual = new Map();
    for (const currentPack of existingPacks) {
        for (const question of currentPack.questions) {
            const key = `${currentPack.contentPackId}\0${question.id}`;
            if (actual.has(key)) errors.push(`Duplicate Anime question identity ${currentPack.contentPackId}/${question.id}.`);
            actual.set(key, currentPack.fileName);
        }
    }
    for (const franchise of ledger.franchises) {
        if (!isRecord(franchise) || typeof franchise.franchiseId !== "string" || !ID_PATTERN.test(franchise.franchiseId) || typeof franchise.displayName !== "string" || !Array.isArray(franchise.packMemberships) || !Array.isArray(franchise.aliases)) {
            errors.push("Anime ledger contains a malformed franchise record.");
            continue;
        }
        if (known.has(franchise.franchiseId)) errors.push(`Duplicate Anime franchise ID ${franchise.franchiseId}.`);
        known.set(franchise.franchiseId, franchise);
        for (const value of [franchise.franchiseId, franchise.displayName, ...franchise.aliases]) {
            if (typeof value !== "string" || !value.trim()) { errors.push(`Franchise ${franchise.franchiseId} has an empty alias or display name.`); continue; }
            const alias = value.trim().toLocaleLowerCase();
            if (aliases.has(alias) && aliases.get(alias) !== franchise.franchiseId) errors.push(`Anime franchise name or alias "${value}" is ambiguous.`);
            aliases.set(alias, franchise.franchiseId);
        }
        let questionCount = 0;
        for (const row of franchise.packMemberships) {
            if (!isRecord(row) || typeof row.contentPackId !== "string" || !Array.isArray(row.questionIds)) { errors.push(`Franchise ${franchise.franchiseId} has malformed pack membership.`); continue; }
            for (const questionId of row.questionIds) {
                questionCount += 1;
                const key = `${row.contentPackId}\0${questionId}`;
                if (membership.has(key)) errors.push(`Duplicate Anime ledger membership ${row.contentPackId}/${questionId}.`);
                membership.set(key, franchise.franchiseId);
            }
        }
        if (franchise.questionCount !== questionCount) errors.push(`Franchise ${franchise.franchiseId} has a stale questionCount.`);
    }
    for (const [identity, fileName] of actual) {
        if (!membership.has(identity)) errors.push(`Published Anime question is missing from franchise ledger: ${identity.replace("\0", "/")}.`);
        else {
            const [packId] = identity.split("\0");
            const franchiseId = membership.get(identity);
            if (!known.has(franchiseId)) errors.push(`Anime membership refers to missing franchise ${franchiseId}.`);
            if (path.basename(fileName, ".json") !== packId) errors.push(`Pack filename and ID disagree for ${packId}.`);
        }
    }
    for (const identity of membership.keys()) if (!actual.has(identity)) errors.push(`Anime ledger refers to unpublished question: ${identity.replace("\0", "/")}.`);
    const packIds = new Set([...actual.keys()].map((key) => key.split("\0")[0]));
    if (ledger.bankSnapshot.questionCount !== actual.size || ledger.bankSnapshot.contentPackCount !== packIds.size) errors.push("Anime ledger bankSnapshot does not match published packs.");

    const additionIds = new Set(pack.questions.map(({ id }) => id));
    const entriesById = new Map();
    for (const [index, entry] of manifest.entries.entries()) {
        if (!isRecord(entry) || !ID_PATTERN.test(entry.questionId ?? "") || !ID_PATTERN.test(entry.franchiseId ?? "")) { errors.push(`Anime franchise entry ${index + 1} requires valid questionId and franchiseId.`); continue; }
        if (entriesById.has(entry.questionId)) errors.push(`Duplicate Anime franchise entry for ${entry.questionId}.`);
        entriesById.set(entry.questionId, entry.franchiseId);
        if (!additionIds.has(entry.questionId)) errors.push(`Anime franchise entry refers to a question not being published: ${entry.questionId}.`);
    }
    for (const questionId of additionIds) if (!entriesById.has(questionId)) errors.push(`Missing required Anime franchise assignment for ${questionId}.`);

    const newFranchises = new Map();
    for (const [index, item] of (manifest.franchises ?? []).entries()) {
        if (!isRecord(item) || !ID_PATTERN.test(item.franchiseId ?? "") || typeof item.displayName !== "string" || !item.displayName.trim() || (item.aliases !== undefined && (!Array.isArray(item.aliases) || item.aliases.some((alias) => typeof alias !== "string" || !alias.trim())))) {
            errors.push(`New Anime franchise definition ${index + 1} requires a valid franchiseId, displayName, and optional string aliases.`);
            continue;
        }
        if (known.has(item.franchiseId) || newFranchises.has(item.franchiseId)) errors.push(`Anime franchise ${item.franchiseId} already exists or is declared twice.`);
        newFranchises.set(item.franchiseId, { franchiseId: item.franchiseId, displayName: item.displayName.trim(), aliases: [...new Set(item.aliases ?? [])] });
    }
    for (const franchiseId of entriesById.values()) if (!known.has(franchiseId) && !newFranchises.has(franchiseId)) errors.push(`New Anime franchise ${franchiseId} needs an explicit displayName definition.`);
    for (const [name, franchiseId] of newFranchises) {
        for (const value of [name, franchiseId.displayName, ...franchiseId.aliases]) {
            const key = value.toLocaleLowerCase();
            if (aliases.has(key) || [...newFranchises.values()].some((other) => other !== franchiseId && [other.franchiseId, other.displayName, ...other.aliases].some((alias) => alias.toLocaleLowerCase() === key))) errors.push(`Anime franchise name or alias "${value}" conflicts with another franchise.`);
        }
    }
    if (errors.length) return { valid: false, errors: [...new Set(errors)].sort(), updatedLedger: null };

    const updatedLedger = structuredClone(ledger);
    const franchiseById = new Map(updatedLedger.franchises.map((item) => [item.franchiseId, item]));
    for (const item of [...newFranchises.values()].sort((a, b) => a.franchiseId.localeCompare(b.franchiseId))) {
        franchiseById.set(item.franchiseId, { ...item, questionCount: 0, packMemberships: [] });
        updatedLedger.franchises.push(franchiseById.get(item.franchiseId));
    }
    for (const question of pack.questions) {
        const franchise = franchiseById.get(entriesById.get(question.id));
        let row = franchise.packMemberships.find((item) => item.contentPackId === pack.contentPackId);
        if (!row) { row = { contentPackId: pack.contentPackId, questionIds: [] }; franchise.packMemberships.push(row); }
        row.questionIds.push(question.id);
        row.questionIds.sort();
        franchise.questionCount += 1;
    }
    updatedLedger.bankSnapshot.questionCount += pack.questions.length;
    updatedLedger.bankSnapshot.contentPackCount += packIds.has(pack.contentPackId) ? 0 : 1;
    return { valid: true, errors: [], updatedLedger };
}

module.exports = { makeAnimeLedgerUpdate };
