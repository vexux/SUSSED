import "./style.css";
import { openEditor } from "./editor";
declare const __API_ORIGIN__: string;
type Key = "anime" | "general" | "bruh";
type Pair = [string, number];
type Pack = {
  filename: string;
  id: string | null;
  type?: string;
  count: number | null;
  errors: string[];
  warnings: string[];
};
type Game = {
  id: Key;
  count: number;
  partial: boolean;
  packs: Pack[];
  errors: string[];
  warnings: string[];
  charts: Record<string, Pair[]>;
  coverage?: {
    mapped?: number;
    records?: number;
    unclassifiedPublishedQuestions?: number;
    topicCounts?: {
      label: string;
      count: number;
      lowCoverage: boolean;
      subtopics: { subtopicId: string; count: number }[];
    }[];
  };
};
type Batch = {
  draftId?: string;
  index: number;
  filename: string;
  kind: string;
  json: boolean | null;
  target: Key | null;
  count?: number;
  packId?: string;
  sidecars: string[];
  duplicates?: object;
  errors?: string[];
  warnings?: string[];
  error?: string;
};
type Snapshot = {
  games: Game[];
  batches: Batch[];
  refreshed: string;
  git: { branch: string; commit: string; dirty: boolean } | null;
};
type Row = {
  pack: string;
  record: Record<string, unknown> | null;
  franchise?: string;
};
const titles = {
  anime: "Anime Fact or Cap",
  general: "General Fact or Cap",
  bruh: "Bruh WTF",
};
const nav = {
  overview: "Overview",
  analytics: "Analytics",
  anime: "Anime",
  general: "General",
  bruh: "Bruh WTF",
  incoming: "Incoming batches",
};
type View = keyof typeof nav;
const icons = {
  overview: "▦",
  analytics: "▥",
  anime: "✦",
  general: "◈",
  bruh: "≋",
  incoming: "⇩",
};
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const num = (n: number) => n.toLocaleString();
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
async function api<T>(url: string): Promise<T> {
  const response = await fetch(__API_ORIGIN__ + url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}
let data: Snapshot,
  view: View = "overview",
  tab = "Questions",
  page = 1,
  revision = 0;
let filters = new URLSearchParams(),
  results: Row[] = [];
function navigate(next: View) {
  view = next;
  tab = "Questions";
  filters = new URLSearchParams();
  page = 1;
  render();
}
function detail(title: string, record: unknown) {
  const panel = $<HTMLDialogElement>("#detail");
  $("#detail h2").textContent = title;
  $("#detail pre").textContent = JSON.stringify(record, null, 2);
  panel.showModal();
}
$("#close").onclick = () => $<HTMLDialogElement>("#detail").close();
function status(g: Game) {
  return g.errors.length
    ? "Needs review"
    : g.warnings.length
      ? "Warnings"
      : "Valid";
}
function badge(g: Game) {
  return (
    '<span class="badge ' +
    (status(g) === "Valid" ? "ok" : "warn") +
    '">' +
    esc(status(g)) +
    "</span>"
  );
}
function coverage(g: Game) {
  if (g.id === "anime")
    return g.coverage
      ? (g.charts.Franchises?.length ?? 0) + " represented franchises"
      : "Franchise coverage unavailable";
  if (g.id === "general")
    return g.coverage
      ? g.coverage.topicCounts?.filter((t) => t.count > 0).length +
          " represented topics"
      : "Topic coverage unavailable";
  return g.charts.Categories.length + " prompt categories";
}
function overview() {
  const total = data.games.reduce((n, g) => n + g.count, 0),
    packs = data.games.reduce((n, g) => n + g.packs.length, 0);
  const candidates = data.batches.filter((b) => b.kind === "Candidate").length;
  const issues = data.batches.filter((b) =>
    ["Malformed", "Unreadable", "Unrecognised"].includes(b.kind),
  ).length;
  return (
    '<div class="metrics">' +
    [
      [
        data.games.some((g) => g.partial)
          ? "Readable questions"
          : "Published questions",
        num(total),
      ],
      ["Published packs", packs],
      ["Incoming candidates", candidates],
      ["Inbox issues", issues],
    ]
      .map(
        ([l, n]) =>
          "<article><small>" +
          l +
          "</small><strong>" +
          n +
          "</strong></article>",
      )
      .join("") +
    '</div><h2>Game libraries</h2><div class="cards">' +
    data.games
      .map(
        (g) =>
          '<button class="lib ' +
          g.id +
          '" data-view="' +
          g.id +
          '"><span class="symbol">' +
          icons[g.id] +
          "</span>" +
          badge(g) +
          "<h3>" +
          titles[g.id] +
          "</h3><b>" +
          num(g.count) +
          "</b> questions · " +
          g.packs.length +
          " packs<hr>" +
          esc(coverage(g)) +
          " <i>↗</i></button>",
      )
      .join("") +
    '</div><div class="lower"><section><h2>Questions by library</h2>' +
    bars(data.games.map((g) => [titles[g.id], g.count])) +
    "</section><section><h2>Incoming batches</h2><p>" +
    num(candidates) +
    " candidate files · " +
    num(issues) +
    ' files needing inspection</p><button data-view="incoming">Open inbox →</button></section></div>'
  );
}
function bars(values: Pair[]) {
  const max = Math.max(1, ...values.map((x) => x[1]));
  return (
    '<div class="bars">' +
    values
      .map(
        ([label, n]) =>
          "<div><span>" +
          esc(label) +
          "</span><b>" +
          num(n) +
          '</b><meter min="0" max="' +
          max +
          '" value="' +
          n +
          '"></meter></div>',
      )
      .join("") +
    "</div>"
  );
}
function select(key: string, label: string, values: string[]) {
  return (
    "<label>" +
    esc(label) +
    '<select data-filter="' +
    key +
    '"><option value="">All</option>' +
    values
      .map(
        (v) =>
          "<option " +
          (filters.get(key) === v ? "selected " : "") +
          'value="' +
          esc(v) +
          '">' +
          esc(v) +
          "</option>",
      )
      .join("") +
    "</select></label>"
  );
}
function library(g: Game) {
  let body = "";
  if (tab === "Analytics") {
    body =
      "<p>" +
      esc(coverage(g)) +
      (g.id === "anime" && g.coverage
        ? " · " + g.coverage.mapped + " of " + g.count + " questions mapped"
        : "") +
      '</p><div class="analytics">' +
      Object.entries(g.charts)
        .map(
          ([label, values]) =>
            "<section><h3>" +
            esc(label) +
            "</h3>" +
            bars(values) +
            "</section>",
        )
        .join("") +
      "</div>";
    if (g.coverage?.topicCounts)
      body +=
        "<details><summary>General topic and subtopic coverage</summary><pre>" +
        esc(JSON.stringify(g.coverage, null, 2)) +
        "</pre></details>";
  } else if (tab === "Packs") {
    body =
      '<div class="table">' +
      g.packs
        .map(
          (p, i) =>
            '<div class="line"><button data-pack="' +
            i +
            '">' +
            esc(p.filename) +
            "</button><span>" +
            esc(p.type ?? p.id) +
            "</span><b>" +
            esc(p.count ?? "Unknown") +
            '</b><button data-inspect="' +
            i +
            '">Details</button></div>',
        )
        .join("") +
      "</div>";
  } else {
    body =
      '<div class="filters"><label>Search questions<input id="search" maxlength="256" placeholder="Question text or ID" value="' +
      esc(filters.get("search")) +
      '"></label>' +
      select(
        "pack",
        "Pack",
        g.packs.map((p) => p.filename),
      ) +
      select(
        "category",
        "Category",
        g.charts.Categories.map((p) => p[0]),
      ) +
      (g.charts.Difficulty
        ? select(
            "difficulty",
            "Difficulty",
            g.charts.Difficulty.map((p) => p[0]),
          )
        : "") +
      (g.charts.Franchises
        ? select(
            "franchise",
            "Franchise",
            g.charts.Franchises.map((p) => p[0]),
          )
        : "") +
      '</div><div id="questions" aria-live="polite">Loading questions…</div>';
  }
  return (
    "<p>" +
    num(g.count) +
    " questions · " +
    g.packs.length +
    " packs · " +
    esc(coverage(g)) +
    " " +
    badge(g) +
    "</p>" +
    (g.errors.length || g.warnings.length
      ? "<details><summary>Validation findings (" +
        (g.errors.length + g.warnings.length) +
        ")</summary><pre>" +
        esc([...g.errors, ...g.warnings].join("\n")) +
        "</pre></details>"
      : "") +
    '<div class="tabs">' +
    ["Questions", "Packs", "Analytics"]
      .map(
        (t) =>
          '<button data-tab="' +
          t +
          '" aria-pressed="' +
          (tab === t) +
          '">' +
          t +
          "</button>",
      )
      .join("") +
    "</div>" +
    body
  );
}
function analytics() {
  return data.games
    .map(
      (g) =>
        "<h2>" +
        titles[g.id] +
        "</h2><p>" +
        esc(coverage(g)) +
        '</p><div class="analytics">' +
        Object.entries(g.charts)
          .map(
            ([label, values]) =>
              "<section><h3>" +
              esc(label) +
              "</h3>" +
              bars(values) +
              "</section>",
          )
          .join("") +
        "</div>",
    )
    .join("");
}
function inbox() {
  if (!data.batches.length)
    return '<section class="empty"><span>⇩</span><h2>Inbox is empty</h2><p>Save a candidate in the Fact or Cap incoming directory, then refresh.</p></section>';
  return (
    '<div class="table">' +
    data.batches
      .map(
        (b) =>
          '<div class="line"><button data-batch="' +
          b.index +
          '">' +
          esc(b.filename) +
          "</button><span>" +
          esc(b.kind) +
          " · " +
          esc(b.target ? titles[b.target] : "Unassigned") +
          "</span><span>" +
          esc(b.packId) +
          "</span><span>" +
          esc(b.count ?? "—") +
          " questions</span><span>" +
          (b.json === null
            ? "Uninspected"
            : b.json
              ? "Valid JSON"
              : "Invalid JSON") +
          "</span><small>" +
          esc(b.error || b.sidecars.join(", ") || "") +
          "</small></div>",
      )
      .join("") +
    "</div>"
  );
}
function render() {
  revision++;
  const g = data.games.find((g) => g.id === view);
  $("#app").innerHTML =
    '<aside><div class="brand"><span>S!</span> SUSSED! <em>Studio</em></div><nav aria-label="Studio">' +
    Object.entries(nav)
      .map(
        ([key, title]) =>
          '<button data-view="' +
          key +
          '" aria-current="' +
          (view === key ? "page" : "false") +
          '"><i>' +
          icons[key as View] +
          "</i>" +
          title +
          "</button>",
      )
      .join("") +
    '</nav><div class="workspace"><strong>Local workspace</strong><small>' +
    esc(
      data.git
        ? data.git.branch +
            " · " +
            data.git.commit +
            " · " +
            (data.git.dirty ? "modified" : "clean")
        : "Git unavailable",
    ) +
    "</small></div></aside><main><header><span>Workspace &nbsp; / &nbsp; " +
    esc(nav[view]) +
    '</span><button id="refresh">↻ &nbsp; Refresh</button></header><div class="heading"><h1>' +
    esc(
      g ? titles[g.id] : view === "overview" ? "Content overview" : nav[view],
    ) +
    "</h1><small>Updated " +
    esc(new Date(data.refreshed).toLocaleTimeString()) +
    "</small></div>" +
    (g
      ? library(g)
      : view === "incoming"
        ? inbox()
        : view === "analytics"
          ? analytics()
          : overview()) +
    "</main>";
  $("#refresh").onclick = refresh;
  if (g && tab === "Questions") {
    $("#search").oninput = (e) =>
      filter("search", (e.target as HTMLInputElement).value);
    document
      .querySelectorAll<HTMLSelectElement>("select")
      .forEach(
        (el) => (el.onchange = () => filter(el.dataset.filter!, el.value)),
      );
    void loadRows();
  }
}
function filter(key: string, value: string) {
  if (value) filters.set(key, value);
  else filters.delete(key);
  page = 1;
  void loadRows();
}
async function loadRows() {
  const seq = ++revision,
    box = $("#questions"),
    query = new URLSearchParams(filters);
  query.set("page", String(page));
  try {
    const r = await api<{ total: number; rows: Row[] }>(
      "/api/games/" + view + "/questions?" + query,
    );
    if (seq !== revision) return;
    results = r.rows;
    box.innerHTML =
      "<p>" +
      num(r.total) +
      " matching questions</p>" +
      r.rows
        .map(
          (row, i) =>
            '<button class="question" data-row="' +
            i +
            '"><small>' +
            esc(row.record?.id ?? "Invalid record") +
            "</small><strong>" +
            esc(row.record?.text ?? row.record?.prompt) +
            "</strong><span>" +
            esc(row.franchise ?? row.record?.category) +
            "</span></button>",
        )
        .join("") +
      (r.total === 0 ? "<p>No questions match these filters.</p>" : "") +
      '<footer><button data-step="-1" ' +
      (page === 1 ? "disabled" : "") +
      ">Previous</button>Page " +
      page +
      " of " +
      Math.max(1, Math.ceil(r.total / 25)) +
      '<button data-step="1" ' +
      (page * 25 >= r.total ? "disabled" : "") +
      ">Next</button></footer>";
  } catch (e) {
    if (seq === revision) box.textContent = String(e);
  }
}
async function refresh() {
  revision++;
  $("#app").innerHTML =
    '<main aria-live="polite">Reading repository inventory…</main>';
  try {
    data = await api<Snapshot>("/api/inventory");
    filters = new URLSearchParams();
    page = 1;
    render();
  } catch (e) {
    $("#app").innerHTML =
      "<main><h1>Inventory unavailable</h1><p>" +
      esc(e) +
      '</p><button id="retry">Retry</button></main>';
    $("#retry").onclick = refresh;
  }
}
$("#app").onclick = async (event) => {
  const el = (event.target as HTMLElement).closest("button");
  if (!el) return;
  const d = el.dataset,
    g = data?.games.find((g) => g.id === view);
  if (d.view) navigate(d.view as View);
  else if (d.tab) {
    tab = d.tab;
    render();
  } else if (d.step) {
    page += Number(d.step);
    void loadRows();
  } else if (d.row)
    detail(String(results[+d.row].record?.id ?? "Question"), results[+d.row]);
  else if (d.inspect && g)
    detail(g.packs[+d.inspect].filename, g.packs[+d.inspect]);
  else if (d.pack && g) {
    filters = new URLSearchParams({ pack: g.packs[+d.pack].filename });
    tab = "Questions";
    page = 1;
    render();
  } else if (d.batch) {
    const draftId = data.batches[+d.batch].draftId;
    if (draftId) {
      try {
        await openEditor(draftId, () => void refresh());
      } catch (e) {
        detail("Draft unavailable", String(e));
      }
      return;
    }
    const expected = data.batches[+d.batch].filename;
    try {
      const batch = await api<Batch & { data?: unknown }>(
        "/api/batches/" + d.batch,
      );
      if (batch.filename !== expected)
        throw new Error("Inbox changed. Refresh to inspect this file.");
      detail(expected, {
        classification: batch.kind,
        target: batch.target ?? "Unassigned",
        jsonValidity: batch.json,
        associatedMetadata: batch.sidecars,
        structuralErrors: batch.errors,
        warnings: batch.warnings,
        readError: batch.error,
        duplicatesAgainstPublishedLibraries: batch.duplicates,
        content: batch.data,
      });
    } catch (e) {
      detail("Batch unavailable", String(e));
    }
  }
};
void refresh();
