const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { scan } = require("./inventory");
const ports = require("../ports.cjs");
const root = path.resolve(__dirname, "../..");

function gitInfo(repository) {
  try {
    const git = (...args) =>
      execFileSync(
        "git",
        ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
        {
          cwd: repository,
          encoding: "utf8",
          timeout: 2000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
    return {
      branch: git("branch", "--show-current") || "Detached HEAD",
      commit: git("rev-parse", "--short", "HEAD"),
      dirty: !!git("status", "--porcelain"),
    };
  } catch {
    return null;
  }
}

function questions(game, query) {
  const keys = [
    "page",
    "search",
    "pack",
    "category",
    "difficulty",
    "franchise",
  ];
  for (const [key, value] of query) {
    if (
      !keys.includes(key) ||
      value.length > 256 ||
      query.getAll(key).length !== 1
    )
      throw new Error("Invalid question filter");
  }
  const page = Number(query.get("page") ?? 1);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !/^[1-9]\d*$/.test(query.get("page") ?? "1")
  )
    throw new Error("Invalid page");
  for (const [key, choices] of Object.entries({
    pack: game.packs.map((p) => p.filename),
    category: game.charts.Categories.map((c) => c[0]),
    difficulty: (game.charts.Difficulty ?? []).map((c) => c[0]),
    franchise: (game.charts.Franchises ?? []).map((c) => c[0]),
  })) {
    if (query.has(key) && !choices.includes(query.get(key)))
      throw new Error("Unknown " + key);
  }
  const search = (query.get("search") ?? "").trim().toLowerCase();
  const rows = game.rows.filter(
    ({ pack, record, franchise }) =>
      (!query.has("pack") || query.get("pack") === pack) &&
      (!query.has("franchise") || query.get("franchise") === franchise) &&
      ["category", "difficulty"].every(
        (k) => !query.has(k) || query.get(k) === (record?.[k] ?? "Unspecified"),
      ) &&
      [record?.text, record?.prompt, record?.id].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(search),
      ),
  );
  return {
    total: rows.length,
    rows: rows.slice((page - 1) * 25, page * 25),
    page,
  };
}

function createServer(repository = root) {
  let current;
  return http.createServer((req, res) => {
    const host = "127.0.0.1:" + req.socket.localPort;
    const origin = req.headers.origin;
    const reply = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    if (
      req.headers.host !== host ||
      (origin &&
        !["http://" + host, "http://127.0.0.1:" + ports.ui].includes(origin))
    )
      return reply(403, { error: "Local access only" });
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    if (req.method !== "GET") return reply(405, { error: "GET required" });
    const delimiter = req.url.indexOf("?");
    const route = delimiter < 0 ? req.url : req.url.slice(0, delimiter);
    const search = delimiter < 0 ? "" : req.url.slice(delimiter + 1);
    const query = new URLSearchParams(search);
    const match = /^\/api\/games\/(anime|general|bruh)\/questions$/.exec(route);
    const batch = /^\/api\/batches\/(0|[1-9]\d*)$/.exec(route);
    if (!match && query.size) return reply(400, { error: "Unexpected query" });
    if (route === "/api/health") return reply(200, { status: "ok" });
    try {
      if (route === "/api/inventory") {
        current = scan(repository);
        const games = Object.values(current.games).map(({ rows, ...rest }) => ({
          ...rest,
          count: rows.length,
        }));
        const batches = current.batches.map(({ data, ...b }, index) => ({
          ...b,
          index,
          packId: data?.contentPackId,
          count: data?.questions?.length,
        }));
        return reply(200, {
          games,
          batches,
          refreshed: current.refreshed,
          git: gitInfo(repository),
        });
      }
      if (!match && !batch) return reply(404, { error: "Unknown resource" });
      current ??= scan(repository);
      if (match) {
        try {
          return reply(200, questions(current.games[match[1]], query));
        } catch (error) {
          return reply(400, { error: error.message });
        }
      }
      const item = current.batches[Number(batch[1])];
      return item ? reply(200, item) : reply(404, { error: "Unknown batch" });
    } catch (error) {
      return reply(503, { error: "Inventory unavailable: " + error.message });
    }
  });
}
if (require.main === module)
  createServer().listen(ports.api, "127.0.0.1", () =>
    console.log("Studio API at http://127.0.0.1:" + ports.api),
  );
module.exports = { createServer, questions };
