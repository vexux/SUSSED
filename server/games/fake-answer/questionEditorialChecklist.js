function codeBlock(value) {
    const text = value === undefined || value === null ? "(not provided)" : String(value);
    const runs = text.match(/`+/gu) ?? [];
    const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
    return `${fence}\n${text}\n${fence}`;
}

function renderQuestionEditorialChecklist(candidate, preview) {
    const questions = Array.isArray(candidate?.questions) ? candidate.questions : [];
    const lines = [
        `# Editorial review packet: ${candidate?.contentPackId ?? "unknown-pack"}`,
        "",
        "> Offline checklist for human review. This report does not approve, rewrite, import, or publish content.",
        "> Structural validation, source metadata, normalized duplicate signals, factual review, editorial quality, and reuse rights are separate considerations.",
        "",
        "## Batch preview signals",
        "",
        `- Target game: ${preview?.target ?? "not checked"}`,
        `- Candidate questions: ${questions.length}`,
        `- Blocking structural/ID/import errors: ${preview?.errors?.length ?? "not checked"}`,
        `- Source/other validation warnings: ${preview?.warnings?.length ?? "not checked"}`,
        `- Likely normalized duplicate matches: ${preview?.duplicateMatches?.length ?? "not checked"}`,
        "",
        "Preview errors, warnings, and duplicate matches are signals to resolve before import. Exact normalized prompt/answer matching is not semantic duplicate detection.",
        "",
        "## Question-by-question review",
        ""
    ];

    if (preview?.errors?.length) {
        lines.push("### Batch errors", "", ...preview.errors.map((error) => `- ${error}`), "");
    }
    if (preview?.warnings?.length) {
        lines.push("### Batch warnings", "", ...preview.warnings.map((warning) => `- ${warning}`), "");
    }

    questions.forEach((question, index) => {
        const id = question?.id ?? `missing-id-${index + 1}`;
        const matches = (preview?.duplicateMatches ?? []).filter((match) => match.candidateId === id);
        const sourceName = question?.sourceName;
        const sourceUrl = question?.sourceUrl;
        lines.push(
            `### ${index + 1}. ${codeBlock(id)}`,
            "",
            "#### Repository-provided candidate data",
            "",
            `- Game: ${codeBlock(preview?.target ?? "not selected")}`,
            `- Content pack: ${codeBlock(candidate?.contentPackId)}`,
            `- Prompt: ${codeBlock(question?.text)}`,
            `- Completion: ${codeBlock(question?.correctCompletion)}`,
            `- Category: ${codeBlock(question?.category)}`,
            `- Tags: ${codeBlock(Array.isArray(question?.tags) ? JSON.stringify(question.tags) : question?.tags)}`,
            `- Difficulty: ${codeBlock(question?.difficulty)}`,
            `- Source name: ${codeBlock(sourceName)}`,
            `- Source URL: ${codeBlock(sourceUrl)}`,
            "",
            "Source name and URL are attribution metadata only; they do not establish claim support or reuse permission.",
            "",
            "#### Automated signals (not editorial decisions)",
            "",
            `- Source metadata present: ${sourceName && sourceUrl ? "yes (presence only)" : "no / incomplete"}`,
            `- Likely normalized matches: ${matches.length ? matches.map((match) => `${match.gameId}/${match.contentPackId}/${match.existingQuestionId} (${match.scope}${match.matchSource ? `, ${match.matchSource}` : ""})`).join("; ") : "none reported"}`,
            "",
            "#### Human evidence and editorial review — complete independently",
            "",
            "- Source opened and relevant passage checked: [ ] yes  [ ] no  [ ] inaccessible",
            "- Evidence locator (page/section/timestamp/quote location): ____________________",
            "- Claim-by-claim source support: [ ] unchecked  [ ] supports  [ ] contradicts  [ ] insufficient",
            "- Compound assertions checked separately: [ ] yes  [ ] not applicable  [ ] unresolved",
            "- Factual accuracy / answer specificity rationale: ____________________",
            "- Prompt clarity and one defensible answer: [ ] pass  [ ] revise  [ ] unresolved",
            "- Answer flexibility, entertainment value, and intended-game fit: [ ] pass  [ ] revise  [ ] unresolved",
            "- Attribution adequacy and source reliability rationale: ____________________",
            "- Rights/reuse status: UNKNOWN until separately assessed; basis/restrictions: ____________________",
            "- Intended use and decision: ____________________  Reviewer/date: ____________________",
            "- Disposition: [ ] keep  [ ] revise  [ ] reject  Rationale: ____________________",
            ""
        );
    });
    lines.push(
        "## Review boundary",
        "",
        "Completing this packet records editorial work only. It does not change the batch, create canonical review decisions, prove factual truth, establish legal reuse rights, or authorize publication. Resolve blocking errors and duplicate signals separately, then use the documented import and inventory commands.",
        ""
    );
    return lines.join("\n");
}

module.exports = { renderQuestionEditorialChecklist };
