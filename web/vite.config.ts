import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return {
  root: path.resolve(process.cwd(), "web"),
  envDir: process.cwd(),
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: Number(env.SENTINEL_WEB_PORT ?? 5173),
    proxy: {
      "/api": { target: env.SENTINEL_API_PROXY ?? "http://127.0.0.1:3001" },
      "/health": { target: env.SENTINEL_API_PROXY ?? "http://127.0.0.1:3001" },
      "/socket.io": { target: env.SENTINEL_API_PROXY ?? "http://127.0.0.1:3001", ws: true }
    },
    ...(env.SENTINEL_TLS_CERT && env.SENTINEL_TLS_KEY ? {
      https: { cert: readFileSync(env.SENTINEL_TLS_CERT), key: readFileSync(env.SENTINEL_TLS_KEY) }
    } : {}),
    fs: {
      allow: [path.resolve(process.cwd())]
    }
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist/web"),
    emptyOutDir: true
  }
  };
});
