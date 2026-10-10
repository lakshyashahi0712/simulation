const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { loadEnvFile } = require("node:process");
if (existsSync(".env")) loadEnvFile(".env");
const env = { ...process.env, VITE_API_URL: "", VITE_ADMIN_TOKEN: "local-sentinel-admin" };
for (const args of [
  ["node_modules/vite/bin/vite.js", "build", "--config", "web/vite.config.ts"],
  ["node_modules/vitest/vitest.mjs", "run", "--config", "browser.config.ts"]
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
