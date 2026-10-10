import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  const staticWebDirectory = process.env.SENTINEL_STATIC_WEB;
  const cert = process.env.SENTINEL_TLS_CERT;
  const key = process.env.SENTINEL_TLS_KEY;
  if (Boolean(cert) !== Boolean(key)) throw new Error("Configure both SENTINEL_TLS_CERT and SENTINEL_TLS_KEY.");
  const server = await createServer({
    autoTickMs: 1000,
    ...(staticWebDirectory ? { staticWebDirectory: resolve(staticWebDirectory) } : {}),
    ...(cert && key ? { tls: { cert: readFileSync(cert), key: readFileSync(key) } } : {})
  });
  try { await server.app.listen({ port, host }); }
  catch (error) { await server.close(); throw error; }

  console.log(`SENTINEL ready: ${cert ? "https" : "http"}://${host}:${port}${staticWebDirectory ? " (built UI, API, and Socket.IO)" : " (API and Socket.IO)"}`);

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
