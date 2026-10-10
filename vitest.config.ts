import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/browser-smoke.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
