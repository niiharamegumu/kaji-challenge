import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
async function selectSettingsCategory(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "設定カテゴリー" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
}

async function expectFocusKeepsFrame(page: Page, control: Locator, surface = control) {
  await expect(control).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const readFrame = (target: Locator) =>
    target.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        border: [style.borderTop, style.borderRight, style.borderBottom, style.borderLeft],
        shadow: style.boxShadow,
      };
    });
  const frame = () => Promise.all([readFrame(control), readFrame(surface)]);
  const before = await frame();
  // Use keyboard modality so this exercises :focus-visible as well as :focus.
  await page.keyboard.press("Tab");
  await control.focus();
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await expect(control).toHaveCSS("outline-style", "none");
  await expect(surface).toHaveCSS("outline-style", "none");
  await expect.poll(frame).toEqual(before);
}

const secret = "kaji-e2e-only-secret-do-not-use-in-production";
const userId = crypto.randomUUID(),
  token = crypto.randomUUID();
const peerToken = crypto.randomUUID(),
  outsiderToken = crypto.randomUUID(),
  summaryToken = crypto.randomUUID(),
  bulkDailyToken = crypto.randomUUID();
test.beforeAll(async () => {
  const path = process.env.KAJI_D1_TEST_PATH;
  if (!path) throw new Error("Run browser tests via bun run test:local for isolated D1 storage");
  const connection = await createTestDatabase(path);
  try {
    await connection.query(
      sql`INSERT INTO auth_user (id,name,email) VALUES (${userId},'テストユーザー',${userId + "@example.com"})`,
    );
    await connection.query(
      sql`INSERT INTO auth_account (id,user_id,provider_id,account_id) VALUES (${crypto.randomUUID()},${userId},'google',${userId})`,
    );
    await provisionUser(connection.repository, userId, new Date());
    await connection.query(
      sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${crypto.randomUUID()},${token},${userId},strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))`,
    );
    const team = (await connection.repository.ListMembershipsByUserID(userId))[0].TeamID;
    for (const [name, accessToken] of [
      ["同期メンバー", peerToken],
      ["別チーム", outsiderToken],
      ["サマリー検証", summaryToken],
      ["日間一括検証", bulkDailyToken],
    ]) {
      const id = crypto.randomUUID();
      await connection.query(
        sql`INSERT INTO auth_user(id,name,email) VALUES (${id},${name},${id + "@example.com"})`,
      );
      await provisionUser(connection.repository, id, new Date());
      if (accessToken === summaryToken) {
        const summaryTeam = (await connection.repository.ListMembershipsByUserID(id))[0].TeamID;
        for (const type of ["daily", "weekly"]) {
          await connection.query(sql`INSERT INTO tasks
            (id,team_id,title,type,penalty_points,required_completions_per_week,sort_key,created_at,updated_at)
            VALUES (${crypto.randomUUID()},${summaryTeam},${type === "daily" ? "サマリー検証日間" : "サマリー検証週間"},${type},1,${type === "daily" ? 1 : 3},100,'2020-05-01T00:00:00.000Z','2020-05-01T00:00:00.000Z')`);
        }
      }
      if (accessToken === peerToken)
        await connection.query(
          sql`UPDATE team_members SET team_id=${team},role='member' WHERE user_id=${id}`,
        );
      await connection.query(
        sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${crypto.randomUUID()},${accessToken},${id},strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))`,
      );
    }
  } finally {
    // The browser Worker must be the sole live owner of this persisted D1.
    await connection.close();
  }
});
test(
  "denied OAuth login shows an explanation and a way back to login",
  { tag: ["@auth"] },
  async ({ page }) => {
    await page.goto("/auth/callback?error=signup_forbidden");
    await expect(page.getByRole("heading", { name: "ログインできませんでした" })).toBeVisible();
    await expect(
      page.getByText(/このアカウントは現在の利用対象に登録されていません/),
    ).toBeVisible();
    await expect(page.getByTestId("boot-screen")).toHaveCount(0);
    await page.getByRole("link", { name: "ログイン画面に戻る" }).click();
    await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
  },
);
test(
  "login screen and API paths never fall back to cached HTML",
  { tag: ["@smoke", "@auth", "@pwa"] },
  async ({ page, request }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
    const document = await request.get("/");
    expect(document.headers()["x-frame-options"]).toBe("DENY");
    expect(document.headers()["x-content-type-options"]).toBe("nosniff");
    expect(document.headers()["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    const serviceWorker = await request.get("/sw.js");
    expect(serviceWorker.headers()["cache-control"]).toContain("no-store");
    const response = await request.get("/api/auth/get-session");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toBeNull();
  },
);
test(
  "settings categories keep drafts and fit narrow screens",
  { tag: ["@settings"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context);
    await page.goto("/settings");
    const navigation = page.getByRole("navigation", { name: "設定カテゴリー" });
    await expect(navigation.getByRole("button")).toHaveCount(5);
    await expect(page.getByRole("heading", { name: "プロフィール", exact: true })).toBeVisible();
    const nickname = page.getByRole("textbox", { name: "ニックネーム", exact: true });
    await nickname.fill("入力途中の名前");
    const teamButton = navigation.getByRole("button", { name: /^チーム/ });
    await teamButton.focus();
    await page.keyboard.press("Enter");
    await expect(teamButton).toHaveAttribute("aria-pressed", "true");
    await expect(nickname).toBeHidden();
    await expect(page.getByRole("button", { name: "離脱して新しいチームを作成" })).toBeHidden();
    await page.getByText("チームの参加・切り替え", { exact: true }).click();
    await expect(page.getByRole("button", { name: "離脱して新しいチームを作成" })).toBeVisible();
    await selectSettingsCategory(page, "プロフィール");
    await expect(nickname).toHaveValue("入力途中の名前");
    for (const category of ["プロフィール", "表示", "通知", "チーム", "アプリ"]) {
      await selectSettingsCategory(page, category);
      await expect(page.getByRole("heading", { name: category, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`settings-${category}.png`),
        animations: "disabled",
        fullPage: true,
      });
    }
    if (testInfo.project.name === "desktop") {
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await selectSettingsCategory(page, "プロフィール");
        await expect(nickname).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: testInfo.outputPath(`settings-width-${width}.png`),
          animations: "disabled",
          fullPage: true,
        });
      }
    }
  },
);
test(
  "settings checks for app updates, retries offline and reapplies a dismissed update prompt",
  { tag: ["@pwa", "@settings"] },
  async ({ page, context }) => {
    await authenticate(context);
    await page.goto("/settings");
    await selectSettingsCategory(page, "アプリ");
    const check = page.getByRole("button", { name: "アップデートを確認" });
    await expect(check).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await check.click();
    await expect(page.getByText("最新バージョンです。")).toBeVisible();
    await context.setOffline(true);
    try {
      await check.click();
      await expect(page.getByText(/更新を確認できませんでした/)).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
    await check.click();
    await expect(page.getByText("最新バージョンです。")).toBeVisible();

    // Keep a real update installing by holding its shell download. Detection must
    // not depend on this gate being released or all precached assets being ready.
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    let downloadStarted = false;
    await context.route("**/_shell.html*", async (route) => {
      if (route.request().serviceWorker()) {
        downloadStarted = true;
        await downloadGate;
      }
      await route.continue();
    });
    try {
      await page.evaluate(async () => {
        for (const name of await caches.keys()) {
          if (name.includes("precache")) await caches.delete(name);
        }
        await navigator.serviceWorker.register("/sw.js?e2e=next");
      });
      await expect.poll(() => downloadStarted).toBe(true);
      const toast = page.getByTestId("status-message").filter({ hasText: "新しいバージョン" });
      await expect(toast).toBeVisible();
      await toast.getByRole("button", { name: "ステータスメッセージを閉じる" }).click();
      await expect(toast).toHaveCount(0);
      await check.click();
      await expect(toast).toBeVisible();
      await expect(check).toBeEnabled();
      expect(
        await page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.installing?.state,
        ),
      ).toBe("installing");
      await toast.getByRole("button", { name: "更新する" }).click();
      const preparing = page
        .getByTestId("status-message")
        .filter({ hasText: "更新を準備しています" });
      await expect(preparing).toBeVisible();
      await expect(preparing.getByRole("button")).toHaveCount(0);
      expect(
        await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
      ).not.toContain("e2e=next");
      const reloaded = page.waitForEvent("load");
      releaseDownload();
      await reloaded;
    } finally {
      releaseDownload();
      await context.unrouteAll({ behavior: "wait" });
    }
    await selectSettingsCategory(page, "アプリ");
    await expect(check).toBeVisible();
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain(
      "/sw.js?e2e=next",
    );
  },
);
test(
  "existing identity loads the main routes through Workers",
  { tag: ["@smoke", "@penalties"] },
  async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: encodeURIComponent(`${token}.${signature}`),
        url: "http://localhost:5194",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    for (const [route, heading] of [
      ["/tasks", "タスク管理"],
      ["/summary", "月次サマリー"],
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(route);
      await page.screenshot({
        path: testInfo.outputPath(route.replaceAll("/", "-") + ".png"),
        fullPage: true,
      });
    }
    await page.goto("/calendar");
    await expect(
      page.getByRole("button", { name: "カレンダーの使い方", exact: true }),
    ).toBeVisible();
    const calendarGrid = page.locator(".reminder-calendar-grid");
    await expect(calendarGrid).toBeVisible();
    await expect(page.getByRole("status", { name: "カレンダーを読み込み中" })).toHaveCount(0);
    await expect(async () => {
      const [grid, header, firstDay, lastDay] = await Promise.all([
        calendarGrid.boundingBox(),
        calendarGrid.getByRole("columnheader").first().boundingBox(),
        calendarGrid.getByRole("cell").first().boundingBox(),
        calendarGrid.getByRole("cell").last().boundingBox(),
      ]);
      if (!grid || !header || !firstDay || !lastDay) {
        throw new Error("The calendar grid, header and boundary days must be rendered");
      }
      // Check the grid rather than the viewport: desktop calendars may extend below the fold.
      // The header remains fixed when the day grid scrolls, so it is the visible top boundary.
      for (const day of [firstDay, lastDay]) {
        expect(day.x).toBeGreaterThanOrEqual(grid.x - 1);
        expect(day.x + day.width).toBeLessThanOrEqual(grid.x + grid.width + 1);
        expect(day.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
        expect(day.y + day.height).toBeLessThanOrEqual(grid.y + grid.height + 1);
      }
      const overflowingContent = await calendarGrid.getByRole("cell").evaluateAll((cells) =>
        cells.flatMap((cell) => {
          const bounds = cell.getBoundingClientRect();
          return Array.from(cell.querySelectorAll('button, [role="img"]')).flatMap((content) => {
            const rect = content.getBoundingClientRect();
            return rect.left < bounds.left - 1 ||
              rect.top < bounds.top - 1 ||
              rect.right > bounds.right + 1 ||
              rect.bottom > bounds.bottom + 1
              ? [
                  {
                    date: cell.getAttribute("data-date"),
                    content: content.getAttribute("aria-label"),
                  },
                ]
              : [];
          });
        }),
      );
      expect(overflowingContent).toEqual([]);
    }).toPass({ timeout: 5_000 });
    await page.screenshot({ path: testInfo.outputPath("calendar.png"), fullPage: true });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "ニックネーム", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/settings");
    await page.goto("/invites");
    await expect(page).toHaveURL("http://localhost:5194/settings");
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "ニックネーム", exact: true })).toBeVisible();
    await page.goto("/penalties");
    await expect(page.getByRole("heading", { name: /ペナルティ/ }).first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/penalties");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "日間タスク", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
    expect(errors).toEqual([]);
  },
);
test(
  "keeps Japanese dates across browser timezones at the month boundary",
  { tag: ["@home", "@tasks", "@calendar", "@summary"] },
  async ({ browser }) => {
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    for (const timezoneId of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
      const context = await browser.newContext({
        baseURL: "http://localhost:5194",
        timezoneId,
      });
      try {
        await context.addCookies([
          {
            name: "better-auth.session_token",
            value: encodeURIComponent(`${token}.${signature}`),
            url: "http://localhost:5194",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        // JST is April 1; UTC and Los Angeles are still March 31.
        await page.clock.setFixedTime(new Date("2026-03-31T15:30:00Z"));
        await page.goto("/calendar");
        await expect(page.getByText("2026年4月1日（水）", { exact: true })).toBeVisible();
        await expect(
          page.locator('.reminder-calendar [role="cell"][aria-current="date"]'),
        ).toHaveAttribute("data-date", "2026-04-01");
        const aprilSecond = page.locator(
          '.reminder-calendar [role="cell"][data-date="2026-04-02"]',
        );
        await expect(aprilSecond.getByRole("button", { name: "4月2日(木)を選択" })).toBeVisible();
        await page.getByRole("button", { name: "次の月" }).click();
        await page.getByRole("button", { name: "今日", exact: true }).click();
        await expect(
          page.locator('.reminder-calendar [role="cell"][aria-current="date"]'),
        ).toHaveAttribute("data-date", "2026-04-01");
        await page.goto("/summary");
        await expect(page.getByRole("button", { name: "対象月を選択" })).toHaveText("2026年04月");
      } finally {
        await context.close();
      }
    }
  },
);

test(
  "PWA installs the generated SPA shell and excludes server functions",
  { tag: ["@pwa"] },
  async ({ page, context }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
    const statusBar = page.locator('meta[name="apple-mobile-web-app-status-bar-style"]');
    await expect(statusBar).toHaveAttribute("content", "default");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      "rgb(246, 244, 239)",
    );
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const paths = await page.evaluate(async () => {
      const names = await caches.keys();
      return (
        await Promise.all(
          names.map(async (name) =>
            (await (await caches.open(name)).keys()).map(
              (request) => new URL(request.url).pathname,
            ),
          ),
        )
      ).flat();
    });
    expect(paths).toContain("/_shell.html");
    expect(
      paths.some((path) => path.startsWith("/_serverFn/") || path.startsWith("/api/auth/")),
    ).toBe(false);
    await context.setOffline(true);
    await page.goto("/calendar");
    await expect(page).toHaveTitle("KajiChalle");
    await expect(statusBar).toHaveAttribute("content", "default");
    await context.setOffline(false);
  },
);

async function authenticate(context: BrowserContext, accessToken = token) {
  const signature = createHmac("sha256", secret).update(accessToken).digest("base64");
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: encodeURIComponent(`${accessToken}.${signature}`),
      url: "http://localhost:5194",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test(
  "creates tasks, reorders with real drag sensors, and preserves navigation",
  { tag: ["@tasks", "@home"] },
  async ({ page, context }) => {
    await authenticate(context);
    await page.goto("/tasks");
    for (const title of ["操作確認A", "操作確認B"]) {
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await page.getByLabel("タスク名", { exact: true }).fill(title);
      await page.getByRole("button", { name: "追加する", exact: true }).click();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }
    const handle = page.getByRole("button", { name: "操作確認B をドラッグして並び替え" });
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const to = await page
      .getByRole("button", { name: "操作確認A をドラッグして並び替え" })
      .boundingBox();
    if (!from || !to) throw new Error("Drag handles are not visible");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 10, { steps: 5 });
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
    const savedOrder = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") &&
        (response.request().postData()?.includes("postTasksReorder") ?? false),
    );
    await page.mouse.up();
    expect((await savedOrder).ok()).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("button", { name: /をドラッグして並び替え/ }).first(),
    ).toHaveAttribute("aria-label", "操作確認A をドラッグして並び替え");
    await page.goto("/");
    await expect(page.getByText("操作確認A", { exact: true })).toBeVisible();
    const dailyButton = page.getByRole("button", { name: /操作確認A.*日間/ });
    await dailyButton.click();
    await expect(dailyButton.getByRole("img")).toHaveAttribute(
      "aria-label",
      "1回目: テストユーザー",
    );
    await expect(dailyButton).toHaveAttribute("aria-busy", "false");
    await page.reload();
    await expect(dailyButton.getByRole("img")).toHaveAttribute(
      "aria-label",
      "1回目: テストユーザー",
    );
    await dailyButton.click();
    await expect(dailyButton.getByRole("img")).toHaveAttribute("aria-label", "1回目: 未完了");
    await page.getByRole("button", { name: "その他", exact: true }).click();
    await page.getByRole("button", { name: "カレンダー", exact: true }).click();
    await expect(page).toHaveURL(/calendar/);
    await page.goBack();
    await expect(page.getByText("操作確認A", { exact: true })).toBeVisible();
  },
);

test(
  "bulk toggles daily tasks only on home and persists both states",
  { tag: ["@home", "@tasks"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context, bulkDailyToken);
    await page.goto("/tasks");
    await expect(page.getByRole("button", { name: /^すべて(完了|未完了)$/ })).toHaveCount(0);
    for (const title of ["一括確認の掃除", "一括確認の洗濯"]) {
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await page.getByLabel("タスク名", { exact: true }).fill(title);
      await page.getByRole("button", { name: "追加する", exact: true }).click();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "ホーム", exact: true }).click();
    const dailyPanel = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "日間タスク" }),
    });
    const cards = dailyPanel.getByRole("button", { name: /一括確認.*日間/ });
    await expect(cards.first()).toBeVisible();
    expect(await cards.first().evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
      "none",
    );
    await expectFocusKeepsFrame(page, cards.first());
    const weeklyPanel = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "週間タスク" }),
    });
    await expect(weeklyPanel.getByRole("button", { name: /^すべて(完了|未完了)$/ })).toHaveCount(0);

    // 一部完了の状態から、残りだけを一括で完了できる。
    const individualSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") &&
        (response.request().postData()?.includes("postTaskCompletion") ?? false),
    );
    await cards.first().click();
    expect((await individualSaved).ok()).toBe(true);
    await expect(cards.first()).toHaveAttribute("aria-busy", "false");
    const bulk = dailyPanel.getByRole("button", { name: "すべて完了", exact: true });
    await expect(bulk).toBeEnabled();
    await bulk.focus();
    await page.keyboard.press("Enter");
    const undo = dailyPanel.getByRole("button", { name: "すべて未完了", exact: true });
    await expect(undo).toBeEnabled();
    await expect(undo).toBeFocused();
    await page.reload();
    await expect(undo).toBeEnabled();
    await expect(cards.getByRole("img", { name: "1回目: 日間一括検証", exact: true })).toHaveCount(
      2,
    );
    await page.screenshot({
      path: testInfo.outputPath("home-daily-all-complete.png"),
      fullPage: true,
    });

    await undo.click();
    const complete = dailyPanel.getByRole("button", { name: "すべて完了", exact: true });
    await expect(complete).toBeEnabled();
    await page.reload();
    await expect(complete).toBeEnabled();
    await expect(cards.getByRole("img", { name: "1回目: 未完了", exact: true })).toHaveCount(2);
    await page.screenshot({
      path: testInfo.outputPath("home-daily-all-incomplete.png"),
      fullPage: true,
    });
    if (testInfo.project.name === "mobile") {
      await page.setViewportSize({ width: 320, height: 800 });
      await expect(complete).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
      await page.screenshot({ path: testInfo.outputPath("home-daily-narrow.png"), fullPage: true });
    }

    await page.getByRole("button", { name: "サマリー", exact: true }).click();
    await expect(page.getByRole("heading", { name: "月次サマリー" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^すべて(完了|未完了)$/ })).toHaveCount(0);
  },
);

test(
  "completed home cards release their animation layer before opening the summary",
  { tag: ["@home", "@tasks", "@summary"] },
  async ({ page, context }) => {
    await authenticate(context);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await page.getByLabel("タスク名", { exact: true }).fill("画面切替の描画確認");
    await page.getByRole("button", { name: "追加する", exact: true }).click();
    await page.getByRole("button", { name: "ホーム", exact: true }).click();

    const dailyPanel = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "日間タスク" }),
    });
    const card = dailyPanel.getByRole("button", { name: /画面切替の描画確認.*日間/ });
    await card.click();
    await expect(card).toContainText("完了");
    await expect
      .poll(() => dailyPanel.evaluate((element) => getComputedStyle(element).transform))
      .toBe("none");

    await page.getByRole("button", { name: "サマリー", exact: true }).click();
    await expect(page.getByRole("heading", { name: "月次サマリー", exact: true })).toBeVisible();
    await expect(dailyPanel).toHaveCount(0);
    await expect(page.locator('main [class*="ring-[color:var(--color-matcha-400)]"]')).toHaveCount(
      0,
    );
  },
);

test(
  "uses the same calendar form shell for creation and editing and persists both",
  { tag: ["@calendar"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context);
    await page.goto("/calendar");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    const shellAppearance = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        width: style.width,
        bottom: style.bottom,
        borderRadius: style.borderRadius,
        background: style.backgroundImage,
        blur: style.backdropFilter,
        padding: style.padding,
      };
    };
    const createDialog = page.getByRole("dialog", { name: "リマインダーを追加" });
    const createAppearance = await createDialog.evaluate(shellAppearance);
    await page.screenshot({ path: testInfo.outputPath("calendar-create.png") });
    await page.getByLabel("タイトル", { exact: true }).fill("予定の保存確認");
    await page.getByLabel("メモ", { exact: true }).fill("忘れずに持参");
    const savedReminder = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") &&
        (response.request().postData()?.includes("postReminder") ?? false),
    );
    await page.getByRole("button", { name: "追加する", exact: true }).click();
    expect((await savedReminder).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("button", { name: "予定の保存確認 を編集" })).toBeVisible();
    await expect(
      page.getByText("忘れずに持参", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "予定の保存確認 を編集" }).click();
    const editDialog = page.getByRole("dialog", { name: "リマインダーを編集" });
    await expect(editDialog).toBeVisible();
    expect(await editDialog.evaluate(shellAppearance)).toEqual(createAppearance);
    await expect(editDialog.getByRole("textbox", { name: "メモ", exact: true })).toHaveValue(
      "忘れずに持参",
    );
    await page.screenshot({ path: testInfo.outputPath("calendar-edit.png") });
    await editDialog.getByLabel("タイトル", { exact: true }).fill("予定の更新確認");
    const updated = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") &&
        (response.request().postData()?.includes("patchReminder") ?? false),
    );
    await editDialog.getByRole("button", { name: "更新する", exact: true }).click();
    expect((await updated).ok()).toBe(true);
    await expect(editDialog).not.toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "予定の更新確認 を編集" }).click();
    await editDialog.getByRole("button", { name: "削除", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "リマインダーを削除しますか" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(editDialog).toBeVisible();
    await editDialog.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(editDialog).not.toBeVisible();

    if (testInfo.project.name === "desktop") {
      const nextMonth = new Date();
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 10);
      const sourceDate = nextMonth.toISOString().slice(0, 10);
      nextMonth.setUTCDate(11);
      const targetDate = nextMonth.toISOString().slice(0, 10);
      const title = "ドラッグによる予定の日付変更";
      await page.goto(`/calendar?date=${sourceDate}`);
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await createDialog.getByLabel("タイトル", { exact: true }).fill(title);
      await expect(createDialog.getByRole("combobox", { name: "種別", exact: true })).toHaveValue(
        "one_time",
      );
      await expect(createDialog.getByLabel("開始日", { exact: true })).toHaveValue(sourceDate);
      const created = page.waitForResponse(
        (response) => response.request().postData()?.includes("postReminder") ?? false,
      );
      await createDialog.getByRole("button", { name: "追加する", exact: true }).click();
      expect((await created).ok()).toBe(true);
      await expect(createDialog).not.toBeVisible();
      const sourceCell = page.locator(
        `.reminder-calendar [role="cell"][data-date="${sourceDate}"]`,
      );
      const targetCell = page.locator(
        `.reminder-calendar [role="cell"][data-date="${targetDate}"]`,
      );
      const event = sourceCell.locator(".reminder-calendar-event").filter({ hasText: title });
      await expect(event).toBeVisible();
      await expect(page.getByRole("status", { name: "カレンダーを読み込み中" })).toHaveCount(0);
      await targetCell.scrollIntoViewIfNeeded();
      const from = await event.boundingBox();
      const to = await targetCell.boundingBox();
      if (!from || !to) throw new Error("Calendar drag source and target must be visible");
      const moved = page.waitForResponse(
        (response) =>
          (response.request().postData()?.includes("patchReminder") ?? false) &&
          (response.request().postData()?.includes(targetDate) ?? false),
      );
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
      await page.mouse.up();
      expect((await moved).ok()).toBe(true);
      await page.reload();
      await expect(
        targetCell.locator(".reminder-calendar-event").filter({ hasText: title }),
      ).toBeVisible();
      await expect(
        sourceCell.locator(".reminder-calendar-event").filter({ hasText: title }),
      ).toHaveCount(0);
      await targetCell.locator(".reminder-calendar-event").filter({ hasText: title }).click();
      await expect(editDialog.getByLabel("開始日", { exact: true })).toHaveValue(targetDate);
      await editDialog.getByRole("button", { name: "閉じる", exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath("calendar-dragged.png"), fullPage: true });
    }
  },
);

test(
  "completion responds before a delayed request and rolls back when it fails",
  { tag: ["@home", "@tasks"] },
  async ({ page, context }) => {
    await authenticate(context);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await page.getByLabel("タスク名", { exact: true }).fill("即時フィードバック確認");
    await page.getByRole("button", { name: "追加する", exact: true }).click();
    await expect(page.getByText("即時フィードバック確認", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "ホーム", exact: true }).click();
    const card = page.getByRole("button", { name: /即時フィードバック確認.*日間/ });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_serverFn/**", async (route) => {
      if (!route.request().postData()?.includes("postTaskCompletion")) {
        await route.continue();
        return;
      }
      await held;
      await route.abort("failed");
    });
    try {
      await card.click();
      // 応答前から完了を表示し、通信中の状態は保つが共通スピナーは出さない。
      await expect(card.getByRole("img")).toHaveAttribute("aria-label", "1回目: テストユーザー");
      await expect(card).toBeDisabled();
      await expect(card).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("status", { name: "保存中", exact: true })).toHaveCount(0);
    } finally {
      release();
    }
    await expect(card.getByRole("img")).toHaveAttribute("aria-label", "1回目: 未完了");
    await expect(card).toBeEnabled();
    await page.unrouteAll({ behavior: "wait" });
    // aria-busy=falseは保存開始前にも成立するため、実際の保存応答を待つ。
    const savedCompletion = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") &&
        (response.request().postData()?.includes("postTaskCompletion") ?? false),
    );
    await card.click();
    const response = await savedCompletion;
    expect(response.ok()).toBe(true);
    await response.finished();
    await expect(card).toHaveAttribute("aria-busy", "false");
    await page.reload();
    await expect(card.getByRole("img")).toHaveAttribute("aria-label", "1回目: テストユーザー");
  },
);

test(
  "retains weekly completions through reload and scheduling a target change",
  { tag: ["@home", "@tasks"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await page.getByLabel("タスク名", { exact: true }).fill("週間3回の保持確認");
    await page.getByLabel("種別", { exact: true }).selectOption("weekly");
    await page.getByLabel("週間必要回数", { exact: true }).fill("3");
    await page.getByRole("button", { name: "追加する", exact: true }).click();
    await expect(page.getByText("週間3回の保持確認", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "ホーム", exact: true }).click();
    const card = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "週間3回の保持確認 を1増やす" }) });
    await expectFocusKeepsFrame(
      page,
      card.getByRole("button", { name: "週間3回の保持確認 を1増やす" }),
      card,
    );
    for (let count = 1; count <= 3; count++) {
      await card.getByRole("button", { name: "週間3回の保持確認 を1増やす" }).click();
      await expect(card.getByText(`進捗 ${count}/3`, { exact: true })).toBeVisible();
    }
    const expectComplete = async () => {
      await expect(card.getByText("進捗 3/3", { exact: true })).toBeVisible();
      for (let slot = 1; slot <= 3; slot++)
        await expect(
          card.getByRole("img", { name: `${slot}回目: テストユーザー`, exact: true }),
        ).toBeVisible();
      await expect(
        card.getByRole("button", { name: "週間3回の保持確認 を1増やす" }),
      ).toBeDisabled();
    };
    await expectComplete();
    await expect(card.getByRole("button", { name: "週間3回の保持確認 を1増やす" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page.clock.install();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    await page.clock.fastForward(31000);
    const refetched = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") &&
        (response.request().postData()?.includes("getTaskOverview") ?? false),
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    expect((await refetched).ok()).toBe(true);
    await expectComplete();
    await page.getByRole("button", { name: "サマリー", exact: true }).click();
    // 月またぎ週は翌月に計上されるため、タスク名ではなく遷移先を確認する。
    await expect(page.getByRole("heading", { name: "月次サマリー", exact: true })).toBeVisible();
    // Expire the unmounted home cache, then fetch from the server again.
    await page.clock.fastForward(301000);
    await page.getByRole("button", { name: "ホーム", exact: true }).click();
    await expectComplete();
    await page.reload();
    await expectComplete();
    await page.goto("/tasks");
    const managed = page
      .getByRole("listitem")
      .filter({ has: page.getByText("週間3回の保持確認", { exact: true }) });
    await managed.getByRole("button", { name: "編集", exact: true }).click();
    const editor = page
      .getByRole("listitem")
      .filter({ has: page.getByLabel("週の必要回数", { exact: true }) });
    const weeklyCount = editor.getByLabel("週の必要回数", { exact: true });
    await expect(weeklyCount).toHaveValue("3");
    const weeklyHelpLabel = "週の必要回数の変更について";
    await editor.getByRole("button", { name: weeklyHelpLabel }).click();
    const weeklyHelp = page.getByRole("dialog", { name: weeklyHelpLabel });
    await expect(weeklyHelp.getByText(/回数の変更は翌週月曜から適用/)).toBeVisible();
    await weeklyHelp.getByRole("button", { name: "閉じる", exact: true }).click();
    await weeklyCount.selectOption("1");
    await page.screenshot({
      path: testInfo.outputPath("weekly-requirement-edit.png"),
      fullPage: true,
    });
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") &&
        (response.request().postData()?.includes("patchTask") ?? false),
    );
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(managed.getByText(/から週1回/)).toBeVisible();
    await page.reload();
    await expect(managed.getByText("必要 3回/週", { exact: true })).toBeVisible();
    await expect(managed.getByText(/から週1回/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath("weekly-requirement-saved.png"),
      fullPage: true,
    });
    await page.goto("/");
    await expectComplete();
  },
);

test(
  "summary immediately saves past daily and weekly changes without confirmation",
  { tag: ["@summary"] },
  async ({ page, context }, testInfo) => {
    test.setTimeout(60_000);
    await authenticate(context, summaryToken);
    await page.goto("/summary?month=2020-05");
    const day = page.getByRole("heading", { name: "5月4日（月）", exact: true }).locator("..");
    const daily = day.getByRole("listitem").filter({ hasText: "サマリー検証日間" });
    const weekly = day.getByRole("listitem").filter({ hasText: "サマリー検証週間" });
    const completionRequests: string[] = [];
    page.on("request", (request) => {
      const body = request.postData();
      if (request.url().includes("/_serverFn/") && body?.includes("postTaskCompletion"))
        completionRequests.push(body);
    });
    const waitForSave = () =>
      page.waitForResponse(
        (response) =>
          response.url().includes("/_serverFn/") &&
          (response.request().postData()?.includes("postTaskCompletion") ?? false),
      );
    const savedDaily = waitForSave();
    await daily.getByRole("button", { name: "過去日タスクを完了にする" }).click();
    await page.getByRole("button", { name: "翌月へ移動" }).click();
    expect((await savedDaily).ok()).toBe(true);
    expect(completionRequests[0]).toContain("2020-05-04");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "前月へ移動" }).click();
    await expect(daily.getByRole("button", { name: "過去日タスクを未完了に戻す" })).toBeVisible();

    for (const slot of [1, 2, 3]) {
      const savedWeekly = waitForSave();
      const add = weekly.getByRole("button", { name: `${slot}回目: 未完了: 1回追加` });
      if (testInfo.project.name === "desktop") {
        if (slot === 1) await add.focus();
        else await page.keyboard.press("Tab");
        await expect(add).toBeFocused();
        await expect(add).toBeEnabled();
        await page.keyboard.press("Enter");
      } else {
        await add.click();
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(weekly.getByRole("button", { name: "変更を取り消す" })).toHaveCount(0);
      expect((await savedWeekly).ok()).toBe(true);
      await expect(
        weekly.getByRole("button", { name: `${slot}回目: サマリー検証: 1回取り消す` }),
      ).toBeVisible();
      if (testInfo.project.name === "desktop") {
        await expect(
          weekly.getByRole("button", { name: `${slot}回目: サマリー検証: 1回取り消す` }),
        ).toBeFocused();
      }
    }
    await page.reload();
    await expect(daily.getByText("完了", { exact: true })).toBeVisible();
    await expect(weekly.getByText("完了", { exact: true })).toBeVisible();

    await day.screenshot({ path: testInfo.outputPath("summary-immediate-completion.png") });
    const removedWeekly = waitForSave();
    await weekly.getByRole("button", { name: "3回目: サマリー検証: 1回取り消す" }).click();
    expect((await removedWeekly).ok()).toBe(true);
    await expect(weekly.getByRole("button", { name: "3回目: 未完了: 1回追加" })).toBeVisible();
    const removedDaily = waitForSave();
    await daily.getByRole("button", { name: "過去日タスクを未完了に戻す" }).click();
    expect((await removedDaily).ok()).toBe(true);
    await page.reload();
    await expect(daily.getByText("未完了", { exact: true })).toBeVisible();
    await expect(weekly.getByText("未完了", { exact: true })).toBeVisible();
    await expect(
      weekly.getByRole("button", { name: "1回目: サマリー検証: 1回取り消す" }),
    ).toBeVisible();
    expect(completionRequests).toHaveLength(6);
  },
);

test(
  "summary previews daily and consecutive weekly changes before saving and rolls back one failure",
  { tag: ["@summary"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context, summaryToken);
    await page.goto("/summary?month=2020-05");
    const day = page.getByRole("heading", { name: "5月11日（月）", exact: true }).locator("..");
    const daily = day.getByRole("listitem").filter({ hasText: "サマリー検証日間" });
    const weekly = day.getByRole("listitem").filter({ hasText: "サマリー検証週間" });
    const requests: Request[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_serverFn/**", async (route) => {
      if (!route.request().postData()?.includes("postTaskCompletion")) {
        await route.continue();
        return;
      }
      const index = requests.push(route.request()) - 1;
      await held;
      if (index === 2) await route.abort("failed");
      else await route.continue();
    });
    try {
      await daily.getByRole("button", { name: "過去日タスクを完了にする" }).click();
      for (const slot of [1, 2, 3]) {
        await weekly.getByRole("button", { name: `${slot}回目: 未完了: 1回追加` }).click();
        await expect(
          weekly.getByRole("button", { name: `${slot}回目: サマリー検証: 1回取り消す` }),
        ).toBeVisible();
      }
      // All requests are still held: these changes must come from the optimistic preview.
      await expect.poll(() => requests.length).toBe(4);
      await expect(daily.getByText("完了", { exact: true })).toBeVisible();
      await expect(daily.getByRole("img", { name: "1回目: サマリー検証" })).toBeVisible();
      await expect(weekly.getByText("完了", { exact: true })).toBeVisible();
      await expect(day.getByText("保存中…")).toHaveCount(0);
      await expect(page.getByRole("status", { name: "保存中", exact: true })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await day.screenshot({ path: testInfo.outputPath("summary-optimistic-pending.png") });
    } finally {
      release();
    }
    const responses = await Promise.all(requests.map((request) => request.response()));
    expect(responses.filter((response) => response !== null)).toHaveLength(3);
    for (const response of responses) {
      if (!response) continue;
      expect(response.ok()).toBe(true);
      await response.finished();
    }
    await expect(page.getByText(/更新失敗:/)).toBeVisible();
    await expect(page.getByRole("status", { name: "保存中", exact: true })).not.toBeVisible();
    await expect(daily.getByText("完了", { exact: true })).toBeVisible();
    await expect(weekly.getByRole("button", { name: /サマリー検証: 1回取り消す/ })).toHaveCount(2);
    await expect(weekly.getByRole("button", { name: "3回目: 未完了: 1回追加" })).toBeVisible();
    await page.unrouteAll({ behavior: "wait" });
    await page.reload();
    await expect(daily.getByText("完了", { exact: true })).toBeVisible();
    await expect(weekly.getByRole("button", { name: /サマリー検証: 1回取り消す/ })).toHaveCount(2);
    await expect(weekly.getByRole("button", { name: "3回目: 未完了: 1回追加" })).toBeVisible();
  },
);

test(
  "real WebSockets synchronize two users, deduplicate tabs and isolate teams",
  { tag: ["@realtime", "@tasks"] },
  async ({ browser, page, context }, testInfo) => {
    const peerContext = await browser.newContext({
      baseURL: "http://localhost:5194",
      viewport: { width: 390, height: 844 },
    });
    const outsiderContext = await browser.newContext({ baseURL: "http://localhost:5194" });
    try {
      await authenticate(context);
      await authenticate(peerContext, peerToken);
      await authenticate(outsiderContext, outsiderToken);
      const peer = await peerContext.newPage(),
        outsider = await outsiderContext.newPage();
      let connections = 0;
      page.on("websocket", () => connections++);
      await page.goto("/");
      const ownIcon = page.getByRole("button", { name: "テストユーザー（接続中）", exact: true });
      await expect(ownIcon).toBeVisible();
      await expect(
        page.getByLabel("チームメンバー", { exact: true }).getByRole("button"),
      ).toHaveCount(2);
      await expect(
        page.getByRole("button", { name: "同期メンバー（未接続）", exact: true }),
      ).toBeVisible();
      await peer.goto("/");
      await outsider.goto("/");
      const peerIcon = page.getByRole("button", { name: "同期メンバー（接続中）", exact: true });
      await expect(peerIcon).toBeVisible();
      await expect(
        peer.getByRole("button", { name: "テストユーザー（接続中）", exact: true }),
      ).toBeVisible();
      await expect(
        outsider.getByRole("button", { name: "別チーム（接続中）", exact: true }),
      ).toBeVisible();
      await expect(
        outsider.getByLabel("チームメンバー", { exact: true }).getByRole("button"),
      ).toHaveCount(1);
      await peerIcon.focus();
      await expect(page.getByText("同期メンバー（接続中）", { exact: true })).toBeVisible();
      await peerIcon.click();
      await expect(peerIcon).toHaveAttribute("aria-expanded", "true");
      await peer.screenshot({ path: testInfo.outputPath("realtime-presence-mobile.png") });
      const extra = await peerContext.newPage();
      await extra.goto("/");
      await expect(
        extra.getByRole("button", { name: "テストユーザー（接続中）", exact: true }),
      ).toBeVisible();
      await expect(peerIcon).toHaveCount(1);
      await extra.close();
      await expect(peerIcon).toBeVisible();

      await page.getByRole("button", { name: "その他", exact: true }).click();
      await page.getByRole("button", { name: "タスク", exact: true }).click();
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await page.getByLabel("タスク名", { exact: true }).fill("リアルタイムの日間");
      await page.getByRole("button", { name: "追加する", exact: true }).click();
      await page.getByRole("button", { name: "ホーム", exact: true }).click();
      const taskA = page.getByRole("button", { name: /リアルタイムの日間.*日間/ });
      const taskB = peer.getByRole("button", { name: /リアルタイムの日間.*日間/ });
      await taskA.click();
      await expect(taskB.getByRole("img")).toHaveAttribute("aria-label", "1回目: テストユーザー");
      await taskB.click();
      await expect(taskA.getByRole("img")).toHaveAttribute("aria-label", "1回目: 未完了");
      await expect(outsider.getByText("リアルタイムの日間", { exact: true })).toHaveCount(0);
      expect(connections).toBe(1);
      await peerContext.close();
      await expect(peerIcon).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "同期メンバー（未接続）", exact: true }),
      ).toBeVisible();
      await expect(ownIcon).toBeVisible();
    } finally {
      await peerContext.close();
      await outsiderContext.close();
    }
  },
);

for (const colorScheme of ["light", "dark"] as const) {
  test(
    `focus keeps normal borders and shadows without adding a frame in ${colorScheme} mode`,
    { tag: ["@theme", "@settings", "@auth", "@pages"] },
    async ({ page, context }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await expectFocusKeepsFrame(page, page.getByRole("button", { name: "Googleでログイン" }));
      await page.goto("/auth/callback?error=signup_forbidden");
      await expectFocusKeepsFrame(page, page.getByRole("link", { name: "ログイン画面に戻る" }));

      await authenticate(context);
      await page.goto("/settings");
      const nickname = page.getByRole("textbox", { name: "ニックネーム", exact: true });
      await expectFocusKeepsFrame(page, nickname);
      await expect(nickname).toHaveCSS("border-top-width", "1px");
      await page.screenshot({
        path: testInfo.outputPath(`focus-settings-${colorScheme}.png`),
        animations: "disabled",
        fullPage: true,
      });
      await selectSettingsCategory(page, "表示");
      const selected = page.getByRole("radio", { name: "システム", exact: true });
      const selectedSurface = selected.locator("..").locator(":scope > span");
      await expect(selected).toBeChecked();
      const unselectedSurface = page
        .getByRole("radio", { name: "ライト", exact: true })
        .locator("..")
        .locator(":scope > span");
      expect(
        await selectedSurface.evaluate((element) => getComputedStyle(element).borderTopColor),
      ).not.toBe(
        await unselectedSurface.evaluate((element) => getComputedStyle(element).borderTopColor),
      );
      await expectFocusKeepsFrame(page, selected, selectedSurface);
      await expect(selected).toBeChecked();
      await page.goto("/pages/new");
      const editor = page.getByRole("textbox", { name: "ページ本文", exact: true });
      await expect(editor).toBeVisible();
      // Check after the lazy-loaded editor stylesheet has entered the cascade.
      const title = page.getByRole("textbox", { name: "タイトル", exact: true });
      await title.click();
      await expect(title).toHaveCSS("outline-style", "none");
      await expectFocusKeepsFrame(page, title);
      await expectFocusKeepsFrame(page, editor);
      await expectFocusKeepsFrame(
        page,
        page.getByRole("button", { name: "ブロックを追加", exact: true }),
      );
      await page.screenshot({
        path: testInfo.outputPath(`focus-shared-page-${colorScheme}.png`),
        animations: "disabled",
        fullPage: true,
      });
    },
  );
}

test(
  "theme follows system, persists explicit choices and colors the main screens",
  { tag: ["@settings", "@theme"] },
  async ({ page, context }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(25, 27, 25)");
    await page.screenshot({
      path: testInfo.outputPath("theme-login-dark.png"),
      animations: "disabled",
      fullPage: true,
    });
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: encodeURIComponent(`${token}.${signature}`),
        url: "http://localhost:5194",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/settings");
    await selectSettingsCategory(page, "表示");
    await expect(page.getByRole("radio", { name: "システム", exact: true })).toBeChecked();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 244, 239)");
    await page.getByText("ダーク", { exact: true }).click();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(25, 27, 25)");
    await page.reload();
    await selectSettingsCategory(page, "表示");
    await expect(page.getByRole("radio", { name: "ダーク", exact: true })).toBeChecked();
    await page.screenshot({
      path: testInfo.outputPath("theme-settings-dark.png"),
      animations: "disabled",
      fullPage: true,
    });
    for (const route of ["/", "/tasks", "/summary", "/penalties", "/calendar"]) {
      await page.goto(route);
      await expect(page.getByTestId("boot-screen")).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(25, 27, 25)");
      if (route === "/calendar") {
        await expect(page.locator(".reminder-calendar-grid")).toBeVisible();
        await expect(page.locator(".reminder-calendar-grid")).toHaveCSS(
          "background-color",
          "rgb(35, 39, 35)",
        );
        await expect(page.locator(".reminder-calendar-day-header").first()).toHaveCSS(
          "background-color",
          "rgb(35, 39, 35)",
        );
      }
      await page.screenshot({
        path: testInfo.outputPath(`theme-dark-${route.replaceAll("/", "_")}.png`),
        animations: "disabled",
        fullPage: true,
      });
    }
    await page.goto("/tasks");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    const taskForm = page.getByRole("dialog", { name: "タスクを追加" });
    await expect(taskForm).toBeVisible();
    await expect(taskForm.getByLabel("タスク名", { exact: true })).toHaveCSS(
      "background-color",
      "rgb(35, 39, 35)",
    );
    await page.screenshot({
      path: testInfo.outputPath("theme-form-dark.png"),
      animations: "disabled",
      fullPage: true,
    });
    await taskForm.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.goto("/settings");
    await selectSettingsCategory(page, "表示");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByText("ライト", { exact: true }).click();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 244, 239)");
    await page.reload();
    await selectSettingsCategory(page, "表示");
    await expect(page.getByRole("radio", { name: "ライト", exact: true })).toBeChecked();
    await page.screenshot({
      path: testInfo.outputPath("theme-settings-light.png"),
      animations: "disabled",
      fullPage: true,
    });
    const other = await context.newPage();
    await other.goto("/settings");
    await selectSettingsCategory(other, "表示");
    await expect(other.getByRole("radio", { name: "ライト", exact: true })).toBeChecked();
    await page.getByRole("radio", { name: "ライト", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "ダーク", exact: true })).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "システム", exact: true })).toBeChecked();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(25, 27, 25)");
    await expect(other.getByRole("radio", { name: "システム", exact: true })).toBeChecked();
    await other.close();
    expect(errors).toEqual([]);
  },
);

test(
  "saved theme is applied before application JavaScript loads",
  { tag: ["@theme"] },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => {
      localStorage.setItem("kaji:theme:v1", "dark");
    });
    await page.route("**/*.js", (route) => route.abort());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(25, 27, 25)");
    for (const splash of await page.getByTestId("boot-screen").all()) {
      await expect(splash).toHaveCSS("background-color", "rgb(25, 27, 25)");
    }
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#191b19");
  },
);
