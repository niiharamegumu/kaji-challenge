import { defineConfig } from "vite-plus";
export default defineConfig({
  test: {
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
    environment: "node",
    include: ["tests/server/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
