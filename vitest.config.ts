import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    // `e2e/` belongs to Playwright. Without this, Vitest also collects the
    // .spec.ts files there and fails them with "Playwright Test did not expect
    // test() to be called here", because two runners are loading the same
    // files. Keep the two suites strictly separated.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src") + "/",
      "astro:env/server": path.resolve(__dirname, "./src/__mocks__/astro-env-server.ts"),
    },
  },
});
