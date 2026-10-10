import "./environment.js";
import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output" || !args[1])) throw new Error("Usage: npm run backup:data -- [--output file.json|directory]");
const input = resolve(process.env.SENTINEL_DATA_FILE ?? "data/sentinel.json");
if (!existsSync(input)) throw new Error(`Persistence file does not exist: ${input}`);
const requestedOutput = args[1];
const generatedName = `${basename(input, ".json")}-${new Date().toISOString().replaceAll(":", "-")}.json`;
const output = requestedOutput?.endsWith(".json")
  ? resolve(requestedOutput)
  : resolve(requestedOutput ?? process.env.SENTINEL_BACKUP_DIR ?? "data/backups", generatedName);
mkdirSync(dirname(output), { recursive: true });
copyFileSync(input, output, constants.COPYFILE_EXCL);
console.log(`Backup created: ${output}`);
