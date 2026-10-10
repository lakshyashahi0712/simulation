import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Shell variables take precedence over .env (Node's built-in env loader).
if (existsSync(".env")) loadEnvFile(".env");
