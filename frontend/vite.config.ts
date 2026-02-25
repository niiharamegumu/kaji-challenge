import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: [
        "app.png",
        "favicon.ico",
        "icons/apple-touch-icon-180x180.png",
      ],
      manifest: false,
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern:
              /^https?:\/\/[^/]+\/(?:assets|icons)\/.*\.(?:js|mjs|css|woff2?|ico|png|svg|webp)$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-assets-v1",
              expiration: {
                maxEntries: 128,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
