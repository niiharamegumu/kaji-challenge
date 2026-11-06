import { injectManifest } from "workbox-build";
import { build as bundle } from "esbuild";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const tooling = {
  lint: {
    ignorePatterns: [
      "src/routeTree.gen.ts",
      "worker-configuration.d.ts",
      "mcp-worker-configuration.d.ts",
      "dist/**",
      "node_modules/**",
    ],
    categories: { correctness: "error" },
    rules: { "no-unused-vars": "error" },
  },
  fmt: {
    ignorePatterns: [
      "src/routeTree.gen.ts",
      "worker-configuration.d.ts",
      "mcp-worker-configuration.d.ts",
      "dist/**",
      "node_modules/**",
      "bun.lock",
    ],
  },
  staged: { "*.{ts,tsx,js,mjs}": "vp lint" },
};
export default defineConfig(({ mode }) => {
  // 検証時だけ普段のD1保存先とOriginを分離する。通常開発・build・previewは同じ公式pluginを使う。
  const testD1Path = process.env.KAJI_D1_TEST_PATH;
  const testOrigin =
    mode === "development-test" ? "http://localhost:5195" : "http://localhost:5194";

  return {
    ...tooling,
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
        // AI has no local emulator. Production bindings come from alchemy.run.ts.
        remoteBindings: false,
        config: (config) => {
          delete config.ai;
          if (testD1Path || mode === "development-test") config.vars.APP_ORIGIN = testOrigin;
        },
        auxiliaryWorkers: [
          {
            configPath: "wrangler.mcp.jsonc",
            viteEnvironment: { name: "mcp" },
            ...(testD1Path || mode === "development-test"
              ? { config: { vars: { APP_ORIGIN: testOrigin } } }
              : {}),
          },
        ],
        ...(testD1Path ? { persistState: { path: testD1Path } } : {}),
      }),
      tanstackStart({ router: { enableRouteGeneration: true }, spa: { enabled: true } }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      {
        name: "kaji:pwa-shell",
        enforce: "post",
        buildApp: {
          order: "post",
          async handler() {
            // Register a standalone classic worker. Its precache needs the final SPA shell.
            const worker = "dist/client/sw.js";
            await bundle({
              entryPoints: ["src/sw.ts"],
              outfile: worker,
              bundle: true,
              format: "iife",
              target: "es2022",
              minify: true,
              sourcemap: true,
            });
            await injectManifest({
              swSrc: worker,
              swDest: worker,
              globDirectory: "dist/client",
              globPatterns: ["**/*.{js,css,html,png,ico,webmanifest}"],
              globIgnores: ["sw.js"],
            });
          },
        },
      },
    ],
    environments: {
      ssr: {
        build: {
          // 現行のweb-push依存にはNode組込moduleへのrequireが残るため、nodejs_compatで解決する。
          // Cloudflare pluginがplatformをneutralにするため、RolldownのNode自動生成には任せられない。
          rolldownOptions: {
            output: {
              banner:
                'import { createRequire as createWorkerRequire } from "node:module"; const require = createWorkerRequire("/worker.js");',
            },
          },
        },
      },
    },
    server: { port: 5174 },
    // SPA生成・previewの待受先をIPv4に揃え、Docker内のlocalhostの名前解決差を防ぐ。
    preview: { host: "127.0.0.1" },
  };
});
