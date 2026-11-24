import { defineConfig } from "@playwright/test";

const backend = "http://127.0.0.1:43101";
const frontend = "http://127.0.0.1:43102";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    browserName: "chromium",
    baseURL: frontend,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node server/server.js",
      url: backend + "/healthz",
      reuseExistingServer: false,
      env: {
        NODE_ENV: "development",
        PORT: "43101",
        AUTH_ENABLED: "false",
        CLIENT_ORIGIN: frontend,
        FIREBASE_AUTH_EMULATOR_ENABLED: "false",
      },
    },
    {
      command: "npm --prefix client run dev -- --host 127.0.0.1 --port 43102 --strictPort",
      url: frontend,
      reuseExistingServer: false,
      env: {
        VITE_AUTH_ENABLED: "false",
        VITE_SERVER_URL: backend,
        VITE_FIREBASE_AUTH_EMULATOR_ENABLED: "false",
      },
    },
  ],
});
