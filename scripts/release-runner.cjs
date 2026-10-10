const { existsSync } = require("node:fs");
const { loadEnvFile } = require("node:process");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

if (existsSync(".env")) loadEnvFile(".env");
process.env.VITE_API_URL = "";
process.env.VITE_ADMIN_TOKEN = process.env.SENTINEL_ADMIN_TOKEN ?? "local-sentinel-admin";
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(["node_modules/vite/bin/vite.js", "build", "--config", "web/vite.config.ts"]);
run(["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"]);
require("./write-server-package.cjs");
process.env.SENTINEL_STATIC_WEB = resolve("dist/web");
require("../dist/server/server/index.js");
