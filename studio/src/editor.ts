declare const __API_ORIGIN__: string;
type Target = "general" | "anime" | "bruh";
type Question = Record<string, unknown>;
type Pack = {
  contentPackId: string;
  questions: Question[];
  [k: string]: unknown;
};
type Review = {
  at: string;
  decision: string;
  reviewer: string;
  notes: string;
  checks: string[];
  current: boolean;
};
type Draft = {
  filename: string;
  packId: string;
  target: Target | null;
  version: string;
  pack: Pack;
  metadata: unknown;
  metadataIssue: string | null;
  sideName: string | null;
  metadataHash: string | null;
  candidateHash: string;
  history: Review[];
  checklist: string[];
  reference?: unknown;
};
type Report = {
  errors: string[];
  metadataErrors: string[];
  warnings: string[];
  info: string[];
  matches: unknown[];
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
function button(text: string, action: () => void) {
  const b = element("button", text);
  b.type = "button";
  b.onclick = action;
  return b;
}
function label(text: string, input: HTMLElement) {
  const l = element("label", text);
  l.append(input);
  return l;
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
async function request<T>(id: string, action = "", body?: unknown): Promise<T> {
  const res = await fetch(
    __API_ORIGIN__ + "/api/drafts/" + id + (action ? "/" + action : ""),
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await res.json();
  if (!res.ok) throw Error(result.error);
  return result;
}

export async function openEditor(id: string, closed: () => void) {
  let saved = await request<Draft>(id);
  const dialog = element("dialog");
  dialog.className = "draft-workspace";
  document.body.append(dialog);
  let pack = structuredClone(saved.pack),
    metadataText = "",
    selected = 0,
    busy = false;
  let report: Report | null = null,
    reviewDirty = false;
  const metaInitial = () =>
    pretty(
      saved.metadata ??
        (saved.target === "anime"
          ? { manifestVersion: 1, franchises: [], entries: [] }
          : { manifestVersion: 1, classifications: [] }),
    );
  metadataText = metaInitial();
  const packDirty = () => pretty(pack) !== pretty(saved.pack);
  const metaDirty = () => metadataText !== metaInitial();
  const changed = () => packDirty() || metaDirty() || reviewDirty;
  const notice = element("p");
  notice.setAttribute("role", "status");
  const dirty = element("strong"),
    changes = element("pre"),
    feedback = element("section");
  const checklist = element("fieldset"),
    reviewer = element("input"),
    notes = element("textarea"),
    decision = element("select");
  for (const value of ["needs-changes", "reviewed"])
    decision.add(
      new Option(
        value === "reviewed" ? "Editorial review complete" : "Needs changes",
        value,
      ),
    );
  const currentReview = () => saved.history.filter((h) => h.current).at(-1);
  function resetReview() {
    reviewer.value = "";
    notes.value = "";
    decision.value = "needs-changes";
    reviewDirty = false;
  }
  function beforeUnload(e: BeforeUnloadEvent) {
    if (changed()) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
  window.addEventListener("beforeunload", beforeUnload);
  function leave() {
    if (!busy && (!changed() || confirm("Discard unsaved workspace changes?")))
      dialog.close();
  }
  dialog.oncancel = (e) => {
    e.preventDefault();
    leave();
  };
  dialog.onclose = () => {
    window.removeEventListener("beforeunload", beforeUnload);
    dialog.remove();
    closed();
  };
  function updateStatus() {
    dirty.textContent = changed() ? "Unsaved changes" : "Saved revision";
    const lines: string[] = [];
    const old = new Map(saved.pack.questions.map((q) => [q?.id, q]));
    for (const q of pack.questions) {
      const before = old.get(q?.id);
      if (!before) lines.push("+ Question " + String(q?.id || "(new)"));
      else
        for (const key of new Set([
          ...Object.keys(before),
          ...Object.keys(q),
        ])) {
          if (pretty(before[key]) !== pretty(q[key]))
            lines.push(
              String(q.id) +
                " · " +
                key +
                ": " +
                pretty(before[key]) +
                " → " +
                pretty(q[key]),
            );
        }
    }
    for (const q of saved.pack.questions)
      if (!pack.questions.some((p) => p?.id === q?.id))
        lines.push("− Question " + q?.id);
    if (metaDirty()) {
      try {
        const before = JSON.parse(metaInitial()),
          after = JSON.parse(metadataText);
        for (const key of new Set([
          ...Object.keys(before),
          ...Object.keys(after),
        ])) {
          if (pretty(before[key]) !== pretty(after[key]))
            lines.push(
              "Metadata · " +
                key +
                "\n− " +
                pretty(before[key]) +
                "\n+ " +
                pretty(after[key]),
            );
        }
      } catch {
        lines.push("Metadata has incomplete JSON.");
      }
    }
    changes.textContent = lines.join("\n") || "No candidate or metadata edits.";
  }
  function showReport() {
    feedback.replaceChildren(element("h3", "Automated validation"));
    if (!report) {
      feedback.append(element("p", "Current draft has not been validated."));
      return;
    }
    for (const [title, items] of [
      ["Errors", report.errors],
      ["Metadata issues", report.metadataErrors],
      ["Warnings", report.warnings],
      ["Information", report.info],
    ] as const) {
      const group = element("details");
      group.open = !!items.length && title !== "Information";
      group.append(
        element("summary", title + " (" + items.length + ")"),
        element("pre", items.join("\n") || "None"),
      );
      feedback.append(group);
    }
    if (report.matches.length) {
      const d = element("details");
      d.append(
        element("summary", "Duplicate matches (" + report.matches.length + ")"),
        element("pre", pretty(report.matches)),
      );
      feedback.append(d);
    }
  }
  function edited() {
    report = null;
    showReport();
    updateStatus();
    notice.textContent = "";
  }
  async function perform(action: string, body: Record<string, unknown>) {
    if (busy) return;
    busy = true;
    const controls = dialog.querySelector("fieldset")!;
    controls.disabled = true;
    try {
      if (action === "validate") {
        report = await request<Report>(id, action, {
          version: saved.version,
          ...body,
        });
        showReport();
      } else {
        const keepPack = action === "metadata" && packDirty(),
          keepMetadata = action === "candidate" && metaDirty();
        saved = await request<Draft>(id, action, {
          version: saved.version,
          ...body,
        });
        if (!keepPack) pack = structuredClone(saved.pack);
        if (!keepMetadata) metadataText = metaInitial();
        report = null;
        resetReview();
        render();
      }
      notice.textContent =
        action === "validate" ? "Validation finished." : "Saved.";
    } catch (e) {
      notice.textContent = String(e);
    } finally {
      busy = false;
      controls.disabled = false;
    }
  }
  function metadata() {
    return saved.target === "bruh" ? null : JSON.parse(metadataText);
  }
  function runValidate() {
    try {
      void perform("validate", { pack, metadata: metadata() });
    } catch (e) {
      notice.textContent = "Invalid metadata JSON: " + e;
    }
  }
  function render() {
    const controls = element("fieldset");
    controls.className = "draft-controls";
    const top = element("div");
    top.className = "heading";
    top.append(element("h2", saved.filename), button("Close workspace", leave));
    const target = element("select");
    target.add(new Option("Choose target", ""));
    for (const k of saved.target === "bruh" ? ["bruh"] : ["anime", "general"])
      target.add(new Option(k, k));
    target.value = saved.target ?? "";
    target.disabled = saved.target === "bruh";
    target.onchange = () => {
      const value = target.value;
      target.value = saved.target ?? "";
      if (!value) return;
      if (changed()) {
        notice.textContent = "Save or discard edits before changing target.";
        return;
      }
      void perform("target", { target: value });
    };
    const status = element("div");
    status.className = "draft-status";
    status.append(
      label("Game target", target),
      dirty,
      element("span", "Pack: " + saved.packId),
    );
    const pane = element("div");
    pane.className = "draft-columns";
    const list = element("select");
    list.size = 10;
    list.setAttribute("aria-label", "Candidate questions");
    selected = Math.min(selected, Math.max(pack.questions.length - 1, 0));
    function listOptions() {
      list.replaceChildren(
        ...pack.questions.map(
          (q, i) =>
            new Option(
              i + 1 + ". " + String(q?.id || "(new question)"),
              String(i),
            ),
        ),
      );
      list.selectedIndex = selected;
    }
    listOptions();
    list.onchange = () => {
      selected = list.selectedIndex;
      render();
    };
    const isBruh = saved.target === "bruh";
    const left = element("section");
    left.append(
      element("h3", "Questions"),
      list,
      button("Add question", () => {
        pack.questions.push(
          isBruh
            ? {
                id: "",
                prompt: "",
                requiredPlayers: 1,
                category: "",
                contentPackId: saved.packId,
              }
            : { id: "", text: "", correctCompletion: "" },
        );
        selected = pack.questions.length - 1;
        edited();
        render();
      }),
    );
    const right = element("section"),
      q = pack.questions[selected];
    right.append(element("h3", "Question editor"));
    if (q && typeof q === "object") {
      const keys = isBruh
        ? [
            "id",
            "prompt",
            "requiredPlayers",
            "category",
            "tags",
            "contentPackId",
          ]
        : [
            "id",
            "text",
            "correctCompletion",
            "sourceName",
            "sourceUrl",
            "category",
            "tags",
            "difficulty",
            ...(Object.hasOwn(q, "contentPackId") ? ["contentPackId"] : []),
          ];
      for (const key of keys) {
        const input =
          key === "text" || key === "prompt"
            ? element("textarea")
            : element("input");
        input.value =
          key === "tags" && Array.isArray(q[key])
            ? (q[key] as string[]).join(", ")
            : String(q[key] ?? "");
        if (key === "contentPackId") input.readOnly = true;
        input.oninput = () => {
          if (
            !input.value &&
            !["id", "text", "prompt", "correctCompletion"].includes(key)
          )
            delete q[key];
          else
            q[key] =
              key === "requiredPlayers"
                ? Number(input.value)
                : key === "tags"
                  ? input.value.split(",").map((s) => s.trim())
                  : input.value;
          if (key === "id") listOptions();
          edited();
        };
        right.append(
          label(key === "tags" ? "tags (comma-separated)" : key, input),
        );
      }
    }
    if (pack.questions.length)
      right.append(
        button("Remove selected question", () => {
          pack.questions.splice(selected, 1);
          edited();
          render();
        }),
      );
    pane.append(left, right);
    const meta = element("section");
    meta.append(element("h3", "Metadata sidecar"));
    if (saved.sideName) {
      const input = element("textarea");
      input.className = "json-editor";
      input.value = metadataText;
      if (saved.metadataIssue) {
        input.readOnly = true;
        meta.append(element("p", saved.metadataIssue));
      }
      input.oninput = () => {
        metadataText = input.value;
        edited();
      };
      meta.append(
        label(
          saved.sideName + (saved.metadataHash ? "" : " · new sidecar"),
          input,
        ),
        element(
          "p",
          saved.target === "anime"
            ? "Assign each questionId to a franchiseId in entries. Define new franchises with franchiseId, displayName and aliases."
            : "Each classification needs contentPackId, questionId, topicId, subtopicId, questionType, underlyingClaimSummary and repetitionReview with outcome and note.",
        ),
      );
      meta.append(
        button("Add missing question rows", () => {
          if (saved.metadataIssue) {
            notice.textContent = saved.metadataIssue;
            return;
          }
          try {
            const m = metadata(),
              anime = saved.target === "anime",
              rows = anime ? m.entries : m.classifications;
            if (!Array.isArray(rows))
              throw Error("Expected an assignments array.");
            for (const q of pack.questions) {
              if (!q?.id || rows.some((r) => r?.questionId === q.id)) continue;
              rows.push(
                anime
                  ? { questionId: q.id, franchiseId: "" }
                  : {
                      contentPackId: saved.packId,
                      questionId: q.id,
                      topicId: "",
                      subtopicId: "",
                      questionType: "",
                      underlyingClaimSummary: "",
                      repetitionReview: { outcome: "", note: "" },
                    },
              );
            }
            metadataText = pretty(m);
            input.value = metadataText;
            edited();
          } catch (e) {
            notice.textContent = String(e);
          }
        }),
      );
      const reference = element("details");
      reference.append(
        element("summary", "Accepted ledger identifiers"),
        element("pre", pretty(saved.reference)),
      );
      meta.append(reference);
    } else
      meta.append(
        element(
          "p",
          isBruh
            ? "Bruh WTF uses its native taxonomy and has no classification sidecar."
            : "Choose a Fact or Cap target to open its sidecar.",
        ),
      );
    const changePanel = element("section");
    changePanel.append(element("h3", "Changes before saving"), changes);
    const save = (kind: "candidate" | "metadata") => {
      if (reviewDirty) {
        notice.textContent =
          "Finish or discard the editorial form before saving file changes.";
        return;
      }
      if (kind === "metadata" && packDirty()) {
        notice.textContent =
          "Save the candidate first so the sidecar is checked against the latest saved questions.";
        return;
      }
      if (
        !(kind === "candidate"
          ? packDirty()
          : metaDirty() || !saved.metadataHash)
      ) {
        notice.textContent = "No changes to save.";
        return;
      }
      try {
        const body = kind === "candidate" ? { pack } : { metadata: metadata() };
        if (
          confirm(
            "Save these edits to " +
              (kind === "candidate" ? saved.filename : saved.sideName) +
              "?",
          )
        )
          void perform(kind, body);
      } catch (e) {
        notice.textContent = String(e);
      }
    };
    changePanel.append(button("Save candidate", () => save("candidate")));
    if (saved.sideName && !saved.metadataIssue)
      changePanel.append(button("Save metadata", () => save("metadata")));
    changePanel.append(
      button("Discard edits / reload", async () => {
        if (
          changed() &&
          !confirm("Discard unsaved edits and reload from disk?")
        )
          return;
        try {
          saved = await request<Draft>(id);
          pack = structuredClone(saved.pack);
          metadataText = metaInitial();
          report = null;
          resetReview();
          render();
          notice.textContent = "Reloaded from disk.";
        } catch (e) {
          notice.textContent = String(e);
        }
      }),
      button("Validate draft", runValidate),
    );
    const human = element("section");
    human.append(element("h3", "Human editorial review"));
    const checked = [
      ...dialog.querySelectorAll<HTMLInputElement>("[data-check]:checked"),
    ].map((c) => c.value);
    checklist.replaceChildren(element("legend", "Editorial checks"));
    for (const item of saved.checklist) {
      const c = element("input");
      c.type = "checkbox";
      c.value = item;
      c.dataset.check = "";
      c.checked = reviewDirty && checked.includes(item);
      checklist.append(label(item, c));
    }
    human.append(
      checklist,
      label("Reviewer", reviewer),
      label("Decision", decision),
      label("Rationale and evidence notes", notes),
    );
    human.oninput = () => {
      reviewDirty = true;
      updateStatus();
    };
    human.append(
      button("Clear editorial form", () => {
        resetReview();
        render();
      }),
    );
    human.append(
      button("Record review", () => {
        if (packDirty() || metaDirty()) {
          notice.textContent =
            "Save candidate and metadata edits before recording a review.";
          return;
        }
        void perform("review", {
          reviewer: reviewer.value,
          notes: notes.value,
          decision: decision.value,
          checks: [...checklist.querySelectorAll("input:checked")].map(
            (c) => (c as HTMLInputElement).value,
          ),
        });
      }),
    );
    human.append(
      element(
        "p",
        currentReview()
          ? "Latest decision for these saved bytes: " +
              currentReview()!.decision
          : "No current review for these saved bytes.",
      ),
    );
    for (const h of [...saved.history].reverse())
      human.append(
        element(
          "p",
          (h.current ? "Matching revision" : "Stale review") +
            " · " +
            h.at +
            " · " +
            h.reviewer +
            " · " +
            h.decision +
            " · " +
            h.notes,
        ),
      );
    controls.append(
      top,
      status,
      notice,
      pane,
      meta,
      changePanel,
      feedback,
      human,
    );
    dialog.replaceChildren(controls);
    updateStatus();
    showReport();
  }
  render();
  dialog.showModal();
}
