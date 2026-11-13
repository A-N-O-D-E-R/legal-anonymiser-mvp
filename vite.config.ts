import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Office requires HTTPS for task panes. Certificates come from `npx office-addin-dev-certs install`.
const certDir = path.join(os.homedir(), ".office-addin-dev-certs");
const https = fs.existsSync(path.join(certDir, "localhost.key"))
  ? { key: fs.readFileSync(path.join(certDir, "localhost.key")), cert: fs.readFileSync(path.join(certDir, "localhost.crt")) }
  : undefined;

export default defineConfig({
  plugins: [react() as never],
  server: { port: 3000, strictPort: true, https, headers: { "Access-Control-Allow-Origin": "*" } },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"], testTimeout: 60000 }
});
