import { injectManifest } from "workbox-build";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA, type VitePluginPWAAPI } from "vite-plugin-pwa";

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
  const pwa = VitePWA({
    strategies: "injectManifest",
    injectManifest: { injectionPoint: undefined },
    srcDir: "src",
    outDir: "dist/client",
    filename: "sw.ts",
    registerType: "prompt",
    injectRegister: false,
    includeAssets: ["app.png", "favicon.ico", "icons/apple-touch-icon-180x180.png"],
    manifest: false,
    devOptions: {
      enabled: false,
    },
  });

  return {
    ...tooling,
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
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
        ...(testD1Path || mode === "development-test"
          ? { config: { vars: { APP_ORIGIN: testOrigin } } }
          : {}),
      }),
      tanstackStart({ router: { enableRouteGeneration: true }, spa: { enabled: true } }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      pwa,
      {
        name: "kaji:pwa-shell",
        enforce: "post",
        buildApp: {
          order: "post",
          async handler() {
            // 複数Worker環境ではPWAのcloseBundleがSW生成を省略するため、
            // SPA shell生成後に公開APIでclient向けSWをbuildしてからprecacheを確定する。
            const pwaApi = pwa.find((plugin) => plugin.name === "vite-plugin-pwa")?.api as
              | VitePluginPWAAPI
              | undefined;
            if (!pwaApi) throw new Error("Vite PWA API is unavailable");
            await pwaApi.generateSW();
            await injectManifest({
              swSrc: "dist/client/sw.js",
              swDest: "dist/client/sw.js",
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
