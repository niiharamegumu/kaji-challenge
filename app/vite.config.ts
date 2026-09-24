import { injectManifest } from "workbox-build";
import { cloudflare, type PluginConfig } from "@cloudflare/vite-plugin";
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
export default defineConfig(({ mode, isPreview }) => {
  // AlchemyがCloudflareプラグインをビルドに追加済みか。Alchemyが設定し、CIでも同じ状態を再現する。
  const alchemyInjectsPlugin = process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1";
  // StartがSPA shellを生成するためのpreview実行か。isPreviewはVite、環境変数はStartが設定する。
  const isSpaPrerender = isPreview === true && process.env.TSS_PRERENDERING === "true";
  // Playwrightの開発起動テストか。playwright.dev.config.tsが --mode development-test を指定する。
  const isDevStartupTest = mode === "development-test";
  // 検証用D1の保存先。verify-local.mjsやCIが一時ディレクトリを指定し、通常起動では未設定。
  const testD1Path = process.env.KAJI_D1_TEST_PATH;

  // Alchemy経由のビルドでは、Alchemyが追加するプラグインを使う。
  // StartのSPA生成は別のpreviewサーバーでこの設定を読み直すため、こちらでも追加する。
  const shouldAddCloudflarePlugin = !alchemyInjectsPlugin || isPreview === true;

  const cloudflareOptions: PluginConfig = {
    viteEnvironment: { name: "ssr" },
  };

  if (isSpaPrerender) {
    // SPA生成にはworkerdが必要だが、デバッガーは不要。
    // Bunでデバッガーの終了処理が失敗するため、このときだけ無効にする。
    cloudflareOptions.inspectorPort = false;
  }

  if (testD1Path) {
    // 検証用D1の保存先を分離し、普段のローカルDBに影響させない。
    cloudflareOptions.persistState = { path: testD1Path };
  }

  if (testD1Path || isDevStartupTest) {
    // 認証のOriginをテストサーバーに合わせる。開発起動テストは5195、ビルド後の検証は5194。
    // 通常の開発・配備では上書きせず、WranglerやAlchemyの設定を使う。
    cloudflareOptions.config = {
      vars: {
        APP_ORIGIN: isDevStartupTest ? "http://localhost:5195" : "http://localhost:5194",
      },
    };
  }

  return {
    ...tooling,
    plugins: [
      shouldAddCloudflarePlugin ? cloudflare(cloudflareOptions) : null,
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
  };
});
