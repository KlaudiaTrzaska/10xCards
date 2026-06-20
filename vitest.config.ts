import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src/"),
      "astro:env/server": path.resolve(__dirname, "./src/__mocks__/astro-env-server.ts"),
    },
  },
});
