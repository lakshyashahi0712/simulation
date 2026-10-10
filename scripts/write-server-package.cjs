const { mkdirSync, writeFileSync } = require("node:fs");
mkdirSync("dist/server", { recursive: true });
writeFileSync("dist/server/package.json", JSON.stringify({ type: "commonjs" }, null, 2));
