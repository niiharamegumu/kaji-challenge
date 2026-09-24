import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  use: {
    baseURL: "http://localhost:5194",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: [
    {
      command: "node_modules/.bin/vp preview --port 5194",
      url: "http://localhost:5194/health",
      reuseExistingServer: false,
      env: {
        WRANGLER_LOG_PATH: "/tmp/kaji-e2e-wrangler.log",
        BETTER_AUTH_SECRET: "kaji-e2e-only-secret-do-not-use-in-production",
        GOOGLE_CLIENT_ID: "e2e-local-only",
        GOOGLE_CLIENT_SECRET: "e2e-local-only",
        SIGNUP_ALLOWED_EMAILS: "allowlisted@example.com",
        VAPID_PRIVATE_KEY: "unused-local-test-key",
      },
    },
  ],
});
