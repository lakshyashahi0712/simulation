import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server/app.js";

const exec = promisify(execFile);

describe("release packaging", () => {
  it("serves UI assets and SPA routes while preserving API and filesystem boundaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "sentinel-web-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), '<title>SENTINEL</title><script>window.token="__SENTINEL_ADMIN_TOKEN__";</script><div id="root"></div><script src="/assets/main.js"></script>');
    writeFileSync(join(root, "assets/main.js"), "window.sentinel = true;");
    const server = await createServer({ persistenceFile: null, autoTickMs: 0, staticWebDirectory: root });
    try {
      const shell = await server.app.inject({ method: "GET", url: "/" });
      expect(shell.statusCode).toBe(200);
      expect(shell.headers["content-type"]).toContain("text/html");
      expect(shell.headers["cache-control"]).toBe("no-cache");
      expect(shell.body).toContain(process.env.SENTINEL_ADMIN_TOKEN ?? "local-sentinel-admin");
      expect(shell.body).not.toContain("__SENTINEL_ADMIN_TOKEN__");
      const asset = await server.app.inject({ method: "GET", url: "/assets/main.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toContain("javascript");
      expect(asset.body).toBe("window.sentinel = true;");
      expect((await server.app.inject({ method: "GET", url: "/health" })).json().status).toBe("ok");
      expect((await server.app.inject({ method: "GET", url: "/api/scenarios" })).json().scenarios).toHaveLength(3);
      expect((await server.app.inject({ method: "GET", url: "/missing-client-route" })).body).toBe(shell.body);
      for (const path of ["/missing.js", "/api/missing", "/.env", "/%2e%2e/package.json", "/assets/missing.js"]) {
        expect((await server.app.inject({ method: "GET", url: path })).statusCode, path).toBe(404);
      }
    } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("backs up a real active session and restores paused state and credentials without replacing existing backups", async () => {
    const root = mkdtempSync(join(tmpdir(), "sentinel-backup-"));
    const data = join(root, "source.json");
    const backup = join(root, "backup.json");
    const server = await createServer({ persistenceFile: data, autoTickMs: 0 });
    try {
      const room = server.manager.createSession("custom-blackout", "Backup Instructor");
      server.manager.start(room.session.id, room.instructor.id);
      server.manager.advance(room.session.id, room.instructor.id, 30);
      const original = readFileSync(data, "utf8");
      const args = ["node_modules/tsx/dist/cli.mjs", "scripts/backup-data.ts", "--output", backup];
      const env = { ...process.env, SENTINEL_DATA_FILE: data };
      await exec(process.execPath, args, { env });
      expect(readFileSync(backup, "utf8")).toBe(original);
      await expect(exec(process.execPath, args, { env })).rejects.toThrow();
      expect(readFileSync(backup, "utf8")).toBe(original);
      const restored = await createServer({ persistenceFile: backup, autoTickMs: 0 });
      try {
        expect(restored.manager.getSessionSummary(room.session.id)).toMatchObject({ status: "paused", simulationTimeSeconds: 30 });
        expect(restored.manager.authenticateParticipant(room.session.id, room.accessToken)).toBe(room.instructor.id);
      } finally { await restored.close(); }
    } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
