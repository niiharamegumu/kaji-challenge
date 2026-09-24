import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browser storage must come from jsdom, not Node's file-backed Web Storage.
    execArgv: ["--no-experimental-webstorage"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
