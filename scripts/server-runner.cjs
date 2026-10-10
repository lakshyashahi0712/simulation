const { existsSync } = require("node:fs");
const { loadEnvFile } = require("node:process");
if (existsSync(".env")) loadEnvFile(".env");
require("../dist/server/server/index.js");
