import { injectManifest } from "workbox-build";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const tooling = {
  lint: {
    ignorePatterns: [
      "src/routeTree.gen.ts",
      "worker-configuration.d.ts",
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
      "dist/**",
      "node_modules/**",
      "bun.lock",
    ],
  },
  staged: { "*.{ts,tsx,js,mjs}": "vp lint" },
};
export default defineConfig(({ mode }) => ({
  ...tooling,
  plugins: [
    process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1"
      ? null
      : cloudflare({
          ...(process.env.KAJI_D1_TEST_PATH
            ? { persistState: { path: process.env.KAJI_D1_TEST_PATH } }
            : {}),
          viteEnvironment: { name: "ssr" },
          ...(process.env.KAJI_D1_TEST_PATH || mode === "development-test"
            ? {
                config: {
                  vars: {
                    APP_ORIGIN:
                      mode === "development-test"
                        ? "http://localhost:5195"
                        : "http://localhost:5194",
                  },
                },
              }
            : {}),
        }),
    tanstackStart({ router: { enableRouteGeneration: true }, spa: { enabled: true } }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      injectManifest: { injectionPoint: undefined },
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["app.png", "favicon.ico", "icons/apple-touch-icon-180x180.png"],
      manifest: false,
      devOptions: {
        enabled: false,
      },
    }),
    {
      name: "kaji:pwa-shell",
      enforce: "post",
      buildApp: {
        order: "post",
        async handler() {
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
}));
