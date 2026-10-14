const fs = require("node:fs");
const path = require("node:path");
const { inspectBatch, TARGETS } = require("./scripts/manage-question-batch");

const HUMAN_REVIEW_ITEMS = [
    "Inspect the cited source passage and decide whether it supports the exact claim.",
    "Assess factual accuracy, wording, clarity, and whether the completion is defensible.",
    "Assess entertainment value and suitability for the selected game.",
    "Assess attribution and reuse rights separately; a URL is not permission."
];

function getCandidateQuestions(candidate) {
    return Array.isArray(candidate) ? candidate : Array.isArray(candidate?.questions) ? candidate.questions : [];
}

function sourceStatus(question) {
    const flags = [];
    if (typeof question?.sourceName !== "string" || !question.sourceName.trim() ||
        typeof question?.sourceUrl !== "string" || !question.sourceUrl.trim()) {
        flags.push("source missing/incomplete");
    }
    if (question?.sourceUrl) {
        try {
            const url = new URL(question.sourceUrl);
            if (!["http:", "https:"].includes(url.protocol)) flags.push("invalid source URL");
            else if (url.protocol !== "https:") flags.push("non-HTTPS source URL");
        } catch {
            flags.push("invalid source URL");
        }
    }
    return flags;
}

function buildQuestionBatchReview({ target, inputPath, fileSystem = fs, contentDirectories = TARGETS }) {
    const absoluteInput = path.resolve(inputPath);
    let candidate = null;
    let candidateLoaded = false;
    const errors = [];
    try {
        candidate = JSON.parse(fileSystem.readFileSync(absoluteInput, "utf8"));
        candidateLoaded = true;
    } catch (error) {
        errors.push(`Unable to read candidate batch ${absoluteInput}: ${error.message}`);
    }

    let preview = null;
    if (candidateLoaded) {
        try {
            preview = inspectBatch({ target, inputPath: absoluteInput, fileSystem, contentDirectories });
        } catch (error) {
            errors.push(error.message);
        }
    }
    if (preview?.errors) errors.push(...preview.errors);

    const questions = getCandidateQuestions(candidate);
    const duplicateMatches = preview?.duplicateMatches ?? [];
    const duplicateIdSet = new Set([
        ...(preview?.duplicateIds ?? []),
        ...(preview?.crossLibraryConflicts ?? [])
    ]);
    const rows = questions.map((question, index) => {
        const id = typeof question?.id === "string" ? question.id : `(missing ID ${index + 1})`;
        const matches = duplicateMatches.filter((match) => match.candidateId === question?.id);
        const questionErrors = (preview?.errors ?? []).filter((error) =>
            error.includes(`question "${question?.id}"`) ||
            error.includes(`Question "${question?.id}"`) ||
            (question?.id && error.includes(`"${question.id}"`))
        );
        const warnings = (preview?.warnings ?? []).filter((warning) =>
            warning.includes(`question "${question?.id}"`) ||
            warning.includes(`Question "${question?.id}"`)
        );
        const flags = [];
        if (questionErrors.length) flags.push("validation error");
        if (duplicateIdSet.has(question?.id)) flags.push("ID conflict");
        if (matches.length) flags.push(`normalized match ×${matches.length}`);
        flags.push(...sourceStatus(question));
        if (warnings.length) flags.push(`${warnings.length} validation warning${warnings.length === 1 ? "" : "s"}`);
        return {
            id,
            prompt: typeof question?.text === "string" ? question.text : "(missing prompt)",
            answer: typeof question?.correctCompletion === "string" ? question.correctCompletion : "(missing answer)",
            category: question?.category ?? "(none)",
            sourceName: question?.sourceName ?? "(missing)",
            sourceUrl: question?.sourceUrl ?? "",
            flags,
            warnings,
            errors: questionErrors,
            duplicateMatches: matches
        };
    });

    const missingOrInvalidSourceRows = rows.filter((row) => row.flags.some((flag) =>
        flag === "source missing/incomplete" || flag === "invalid source URL"
    ));
    const nonHttpsRows = rows.filter((row) => row.flags.includes("non-HTTPS source URL"));
    const duplicateCandidateIds = new Set(duplicateMatches.map((match) => match.candidateId));
    const duplicateIdCount = duplicateIdSet.size;
    const structuralErrors = errors.filter((error) => !(
        error.includes("sourceName and sourceUrl") ||
        error.startsWith("Duplicate question IDs:") ||
        error.includes("duplicates question ID") ||
        error.startsWith("Question IDs already used in another registered library:") ||
        error.includes("content pack already exists")
    ));
    const categories = {};
    for (const row of rows) categories[row.category] = (categories[row.category] ?? 0) + 1;

    return {
        target,
        inputPath: absoluteInput,
        contentPackId: candidate && !Array.isArray(candidate) ? candidate.contentPackId ?? "(missing)" : "(unknown)",
        candidateCount: rows.length,
        structurallyEligible: Boolean(preview?.canImport),
        errors: [...new Set(errors)],
        structuralErrors,
        warnings: preview?.warnings ?? [],
        duplicateMatches,
        duplicateIdCount,
        duplicateCandidateCount: duplicateCandidateIds.size,
        missingOrInvalidSourceCount: missingOrInvalidSourceRows.length,
        nonHttpsSourceCount: nonHttpsRows.length,
        humanReviewQuestionCount: rows.length,
        categoryCounts: Object.fromEntries(Object.entries(categories).sort(([a], [b]) => a.localeCompare(b))),
        rows,
        semanticDetection: "No semantic duplicate detector is available. Compare claim meaning and prompt patterns manually; existing ledger overlap notes concern published questions and do not establish candidate matches."
    };
}

function shorten(value, limit) {
    const text = String(value ?? "").replace(/[\r\n\t]+/gu, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function formatTable(rows) {
    const widths = [Math.max(11, ...rows.map((row) => row.id.length)), 36, 16, 14, 30, 28];
    const headings = ["Question ID", "Prompt", "Answer", "Category", "Source name / URL", "Automated flags"];
    const values = rows.map((row) => [
        row.id,
        shorten(row.prompt, widths[1]),
        shorten(row.answer, widths[2]),
        shorten(row.category, widths[3]),
        shorten(row.sourceUrl ? `${row.sourceName} ${row.sourceUrl}` : row.sourceName, widths[4]),
        shorten(row.flags.length ? row.flags.join(", ") : "No automated warnings", widths[5])
    ]);
    const render = (cells) => `| ${cells.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ")} |`;
    return [render(headings), render(widths.map((width) => "-".repeat(width))), ...values.map(render)].join("\n");
}

function summaryLines(report) {
    const duplicateLabel = report.duplicateMatches.length
        ? `${report.duplicateMatches.length} normalized prompt/completion match record(s) across ${report.duplicateCandidateCount} candidate(s)`
        : "none reported";
    const eligible = report.structurallyEligible
        ? "Yes, structurally; human review is still required and normalized matches need explicit duplicate approval before import."
        : "No; resolve the blocking errors before import.";
    return [
        `Target: ${report.target}`,
        `Pack: ${report.contentPackId}`,
        `Candidate questions: ${report.candidateCount}`,
        `Blocking validation/import errors: ${report.errors.length} (${report.structuralErrors.length} structural/schema/configuration)` ,
        `Duplicate question ID conflicts: ${report.duplicateIdCount}`,
        `Exact/normalized content matches: ${duplicateLabel}`,
        `Semantic duplicates: not detected automatically; human comparison required.` ,
        `Missing/invalid source metadata: ${report.missingOrInvalidSourceCount} candidate(s); non-HTTPS URLs: ${report.nonHttpsSourceCount}`,
        `Questions requiring source/factual review: ${report.humanReviewQuestionCount} of ${report.candidateCount}`,
        `Automated validation warnings: ${report.warnings.length}`,
        `Category counts (descriptive, not a balance judgment): ${Object.entries(report.categoryCounts).map(([name, count]) => `${name} ${count}`).join(", ") || "none"}`,
        `Structurally eligible for import: ${eligible}`
    ];
}

function formatTerminalReview(report) {
    const lines = [
        "General question batch review (offline; read-only)",
        ...summaryLines(report),
        "",
        "Question review table (source name and full URL follow each row):",
        formatTable(report.rows)
    ];
    for (const row of report.rows) {
        lines.push(`  Source for ${row.id}: ${row.sourceName}${row.sourceUrl ? ` <${row.sourceUrl}>` : ""}`);
        for (const match of row.duplicateMatches) {
            lines.push(`  Match for ${row.id}: ${match.gameId}/${match.contentPackId}/${match.existingQuestionId} (${match.scope}${match.matchSource ? `, ${match.matchSource}` : ""})`);
        }
    }
    if (report.errors.length) lines.push("", "Blocking errors:", ...report.errors.map((error) => `- ${error}`));
    if (report.warnings.length) lines.push("", "Automated warnings:", ...report.warnings.map((warning) => `- ${warning}`));
    lines.push("", "Human review required for every candidate:", ...HUMAN_REVIEW_ITEMS.map((item) => `- ${item}`));
    lines.push("A present URL is attribution only. This report does not inspect sources, verify facts, establish reuse rights, or approve publication.");
    return lines.join("\n");
}

function markdownCell(value) {
    return String(value ?? "").replace(/[\r\n]+/gu, " ").replace(/\|/gu, "\\|");
}

function renderMarkdownReview(report) {
    const lines = [
        `# General question batch review: ${report.contentPackId}`,
        "",
        "Offline consolidated report. It does not approve, rewrite, import, or publish questions.",
        "",
        ...summaryLines(report).map((line) => `- ${line}`),
        "",
        "## Questions",
        "",
        "| Question ID | Prompt | Answer | Category | Source | Automated signals |",
        "| --- | --- | --- | --- | --- | --- |"
    ];
    for (const row of report.rows) {
        const source = row.sourceUrl
            ? `[${markdownCell(row.sourceName)}](<${row.sourceUrl}>)`
            : markdownCell(row.sourceName);
        lines.push(`| ${markdownCell(row.id)} | ${markdownCell(row.prompt)} | ${markdownCell(row.answer)} | ${markdownCell(row.category)} | ${source} | ${markdownCell(row.flags.length ? row.flags.join(", ") : "No automated warnings")} |`);
        for (const match of row.duplicateMatches) lines.push(`  - ${markdownCell(row.id)} matches ${match.gameId}/${match.contentPackId}/${match.existingQuestionId} (${match.scope}${match.matchSource ? `, ${match.matchSource}` : ""}).`);
    }
    if (report.errors.length) lines.push("", "## Blocking errors", "", ...report.errors.map((error) => `- ${error}`));
    if (report.warnings.length) lines.push("", "## Automated warnings", "", ...report.warnings.map((warning) => `- ${warning}`));
    lines.push("", "## Human review required", "", ...HUMAN_REVIEW_ITEMS.map((item) => `- ${item}`));
    lines.push("", report.semanticDetection, "", "Source links are candidate-provided attribution, not proof of factual support or reuse permission. Structural eligibility is not factual, legal, or publication approval.");
    return `${lines.join("\n")}\n`;
}

module.exports = { buildQuestionBatchReview, formatTerminalReview, renderMarkdownReview, summaryLines };
