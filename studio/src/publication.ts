type Disposition = { questionId: string; outcome: string; rationale: string };
type Approval = {
  approvalVersion: 1;
  target: string;
  contentPackId: string;
  candidateSha256: string;
  ledgerMetadataSha256: string;
  reviewerId: string;
  rationale: string;
  approvedAt: string;
  decisions: Disposition[];
};
type Result = {
  status: string;
  previewId?: string;
  baseline: { kind: string; commit: string; note?: string };
  blockers: string[];
  editorial?: { reviewer: string; notes: string; at: string };
  evidence?: Record<string, unknown>;
  review?: {
    target: string;
    contentPackId: string;
    candidateSha256: string;
    ledgerMetadataSha256: string;
    warnings: string[];
    perQuestion: {
      questionId: string;
      idStatus: string;
      duplicateMatches: unknown[];
    }[];
  };
  files?: {
    path: string;
    operation: string;
    before: string | null;
    oldSha256: string | null;
    beforeSize: number;
    after: string;
    size: number;
    sha256: string;
  }[];
};
type Call = <T>(action: string, body: unknown) => Promise<T>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function button(name: string, action: () => void) {
  const b = el("button", name);
  b.type = "button";
  b.onclick = action;
  return b;
}
function detail(label: string, value: unknown) {
  const d = el("details");
  d.append(
    el("summary", label),
    el(
      "pre",
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    ),
  );
  return d;
}
export function publicationPanel(
  version: string,
  call: Call,
  dirty: () => boolean,
) {
  const panel = el("section"),
    output = el("div"),
    message = el("p");
  message.setAttribute("role", "status");
  let generation = 0;
  async function inspect(approval?: Approval) {
    const epoch = ++generation;
    output.replaceChildren();
    if (dirty()) {
      message.textContent = "Save changes before preview.";
      return;
    }
    message.textContent = "Calculating preview…";
    try {
      const r = await call<Result>("publication-preview", {
        version,
        approval,
      });
      if (epoch !== generation || dirty() || !panel.isConnected) return;
      const baseline =
        r.baseline.kind === "dev-simulation"
          ? "Simulation against dev"
          : "Data worktree";
      message.textContent = [
        baseline,
        r.baseline.commit,
        r.status,
        r.baseline.note,
        ...r.blockers,
      ]
        .filter(Boolean)
        .join(" · ");
      if (r.review)
        output.append(
          detail("Publication review and duplicate matches", r.review),
        );
      if (r.status === "needs-decisions" && r.review && r.editorial) {
        const rows: Disposition[] = [];
        const form = el("fieldset");
        form.append(el("legend", "Decide each question"));
        for (const q of r.review.perQuestion) {
          const label = el("label", q.questionId),
            select = el("select"),
            reason = el("input");
          const choices =
            q.idStatus === "same-id-identical"
              ? ["already-published", "exclude"]
              : q.duplicateMatches.length
                ? ["publish-distinct", "exclude"]
                : ["publish", "exclude"];
          select.add(new Option("Choose outcome", ""));
          for (const value of choices) select.add(new Option(value, value));
          const row = { questionId: q.questionId, outcome: "", rationale: "" };
          rows.push(row);
          select.onchange = () => {
            row.outcome = select.value;
          };
          reason.oninput = () => {
            row.rationale = reason.value;
          };
          label.append(select);
          const rationale = el("label", "Rationale for " + q.questionId);
          rationale.append(reason);
          form.append(label, rationale);
        }
        const review = r.review;
        const approver = el("input"),
          justification = el("textarea");
        const attribution = el("label", "Publication reviewer"),
          notes = el("label", "Publication rationale");
        attribution.append(approver);
        notes.append(justification);
        form.append(attribution, notes);
        form.append(
          button("Calculate exact changes", () => {
            if (
              !approver.value.trim() ||
              !justification.value.trim() ||
              rows.some(
                (row) =>
                  !row.outcome ||
                  (["exclude", "publish-distinct"].includes(row.outcome) &&
                    !row.rationale.trim()),
              )
            ) {
              message.textContent =
                "Complete the reviewer, rationale and each question decision.";
              return;
            }
            void inspect({
              approvalVersion: 1,
              target: review.target,
              contentPackId: review.contentPackId,
              candidateSha256: review.candidateSha256,
              ledgerMetadataSha256: review.ledgerMetadataSha256,
              approvedAt: new Date().toISOString(),
              reviewerId: approver.value.trim(),
              rationale: justification.value.trim(),
              decisions: rows,
            });
          }),
        );
        output.append(form);
      }
      if (r.files) {
        output.append(
          detail("Decisions, inventory and reconciliation", r.evidence),
        );
        for (const f of r.files) {
          const d = detail(
            baseline +
              " · " +
              f.operation +
              " " +
              f.path +
              " · " +
              f.size +
              " bytes · " +
              f.sha256,
            f.after,
          );
          if (f.before !== null)
            d.append(
              detail(
                "Original ledger · " + f.beforeSize + " bytes · " + f.oldSha256,
                f.before,
              ),
            );
          d.append(
            button(
              "Copy proposed file",
              () =>
                void navigator.clipboard.writeText(f.after).catch((e) => {
                  message.textContent = String(e);
                }),
            ),
          );
          output.append(d);
        }
        if (r.status === "preview-ready" && approval)
          output.append(
            button("Publish these files locally", async () => {
              if (
                dirty() ||
                !confirm(
                  "Create the displayed pack, replace the ledger and record a receipt in the data worktree?",
                )
              )
                return;
              try {
                const result = await call<{ status: string }>("publish", {
                  version,
                  approval,
                  expectedPreviewId: r.previewId,
                  confirmation: "publish " + r.previewId,
                });
                output.replaceChildren();
                message.textContent = result.status + " · " + r.previewId;
              } catch (e) {
                output.replaceChildren();
                message.textContent = String(e);
              }
            }),
          );
        output.append(
          button("Download " + baseline + " evidence", () => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(r)], { type: "application/json" }),
            );
            const a = el("a");
            a.href = url;
            a.download = r.baseline.kind + "-" + r.previewId + ".json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }),
        );
      }
    } catch (e) {
      if (epoch === generation) message.textContent = String(e);
    }
  }
  panel.append(
    el("h3", "Publication"),
    button("Preview publication", () => void inspect()),
    message,
    output,
  );
  return {
    panel,
    invalidate() {
      generation++;
      output.replaceChildren();
      message.textContent = "Save changes to refresh publication preview.";
    },
  };
}
