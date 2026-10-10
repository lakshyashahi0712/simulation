import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json"
};

/** Serve the production build alongside HTTP and Socket.IO, on one origin. */
export function registerStaticWeb(app: FastifyInstance, directory: string): void {
  const root = resolve(directory);
  const index = resolve(root, "index.html");
  if (!existsSync(index)) throw new Error(`Web build missing at ${index}. Run npm run web:build first.`);
  app.get("/*", async (request, reply) => {
    const path = (request.params as { "*": string })["*"];
    if (path === "api" || path.startsWith("api/") || path.startsWith("socket.io") || path.split("/").some((segment) => segment.startsWith("."))) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    let target = resolve(root, path || "index.html");
    if (!target.startsWith(`${root}${sep}`)) return reply.code(404).send({ error: "NOT_FOUND" });
    if (!existsSync(target) || !statSync(target).isFile()) {
      if (extname(path) || path.startsWith("assets/")) return reply.code(404).send({ error: "NOT_FOUND" });
      target = index;
    }
    reply.type(mime[extname(target)] ?? "application/octet-stream");
    reply.header("cache-control", target === index ? "no-cache" : "public, max-age=31536000, immutable");
    return reply.send(createReadStream(target));
  });
}
