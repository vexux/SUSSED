import ports from "./ports.cjs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

function localRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const host = "127.0.0.1:" + ports.ui;
  if (
    req.headers.host !== host ||
    (req.headers.origin && req.headers.origin !== "http://" + host)
  ) {
    res.writeHead(403);
    res.end("Local access only");
    return;
  }
  next();
}
export default {
  plugins: [
    {
      name: "studio-local-access",
      configureServer(server) {
        server.middlewares.use(localRequest);
      },
      configurePreviewServer(server) {
        server.middlewares.use(localRequest);
      },
    },
  ],
  envDir: false,
  define: { __API_ORIGIN__: JSON.stringify("http://127.0.0.1:" + ports.api) },
  server: {
    host: "127.0.0.1",
    port: ports.ui,
    strictPort: true,
    cors: false,
    fs: {
      strict: true,
      allow: [path.resolve("."), path.resolve("../client/node_modules/vite")],
      deny: ["**/.env*", "**/.git/**", "**/server/**", "**/test/**"],
    },
  },
  preview: { host: "127.0.0.1", port: ports.ui, strictPort: true },
};
