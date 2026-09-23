import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/dev",
  outputDir: "test-results/dev",
  workers: 1,
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5195",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node_modules/.bin/vp dev --mode development-test --host 127.0.0.1 --port 5195 --strictPort",
    url: "http://localhost:5195/health",
    reuseExistingServer: process.env.KAJI_DEV_USE_EXISTING === "true",
    env: {
      WRANGLER_LOG_PATH: "/tmp/kaji-dev-test-wrangler.log",
      BETTER_AUTH_SECRET: "kaji-dev-test-secret-not-for-production",
      GOOGLE_CLIENT_ID: "dev-test-only",
      GOOGLE_CLIENT_SECRET: "dev-test-only",
      SIGNUP_ALLOWED_EMAILS: "dev-test@example.com",
      VAPID_PRIVATE_KEY: "unused-dev-test-key",
    },
  },
});
