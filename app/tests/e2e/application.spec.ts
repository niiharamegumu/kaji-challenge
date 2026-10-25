import { test, expect, type BrowserContext, type Locator, type Request } from "@playwright/test";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import {
  installAssistEncodingLoad,
  installAssistMediaFixture,
  installNativeAssistAudioFixture,
  readAssistAudioUpload,
} from "./assist-fixture";
const secret = "kaji-e2e-only-secret-do-not-use-in-production";
const userId = crypto.randomUUID(),
  token = crypto.randomUUID();
const peerToken = crypto.randomUUID(),
  outsiderToken = crypto.randomUUID(),
  categoryOrderToken = crypto.randomUUID(),
  swipeAreaToken = crypto.randomUUID(),
  summaryToken = crypto.randomUUID(),
  bulkDailyToken = crypto.randomUUID(),
  todoDelayToken = crypto.randomUUID(),
  todoDefaultToken = crypto.randomUUID(),
  performanceToken = crypto.randomUUID();
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
      ["カテゴリー順序", categoryOrderToken],
      ["スワイプ領域", swipeAreaToken],
      ["サマリー検証", summaryToken],
      ["日間一括検証", bulkDailyToken],
      ["ToDo猶予検証", todoDelayToken],
      ["ToDo初期カテゴリー", todoDefaultToken],
      ["キャッシュ検証", performanceToken],
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
      "camera=(), microphone=(self), geolocation=()",
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
  "existing identity loads every route and updates todo through Workers",
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
      ["/todos", "ToDo"],
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(route);
      await page.screenshot({
        path: testInfo.outputPath(route.replaceAll("/", "-") + ".png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await page.getByPlaceholder("例: 牛乳", { exact: true }).fill("検証用の牛乳");
    await page.getByRole("button", { name: "追加する", exact: true }).click();
    await expect(page.getByText("検証用の牛乳", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("検証用の牛乳", { exact: true })).toBeVisible();
    await page.goto("/calendar");
    await expect(page.getByText(/今月と来月以降の予定を表示します/)).toBeVisible();
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
    await expect(page.getByText("テストユーザー", { exact: true }).first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/settings");
    await page.goto("/invites");
    await expect(page).toHaveURL("http://localhost:5194/settings");
    await expect(page.getByText("テストユーザー", { exact: true }).first()).toBeVisible();
    await page.goto("/penalties");
    await expect(page.getByRole("heading", { name: /ペナルティ/ }).first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/penalties");
    await page.goto("/");
    await expect(page.getByText("検証用の牛乳", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
    expect(errors).toEqual([]);
  },
);
test(
  "opens the saved default category on home and ToDo without changing category order",
  { tag: ["@todos", "@home", "@settings"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context, todoDefaultToken);
    await page.goto("/todo-categories");
    for (const name of ["仕事", "買い物"]) {
      await page.getByLabel("新しいカテゴリー").fill(name);
      await page.getByRole("button", { name: "カテゴリーを追加", exact: true }).click();
      await expect(page.getByRole("button", { name: `${name} を削除`, exact: true })).toBeVisible();
    }
    await page.goto("/settings");
    const select = page.getByRole("combobox", { name: "最初に表示するToDoカテゴリー" });
    await select.selectOption({ label: "買い物" });
    await page.reload();
    await expect(select.locator("option:checked")).toHaveText("買い物");
    await page.screenshot({
      path: testInfo.outputPath("todo-default-settings.png"),
      fullPage: true,
    });
    const filter = page.getByRole("group", { name: "カテゴリーで絞り込み" });
    for (const path of ["/", "/todos"]) {
      await page.goto(path);
      await expect(filter.getByRole("button", { name: "買い物", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(filter.getByRole("button")).toHaveText(["すべて", "未分類", "仕事", "買い物"]);
      await filter.getByRole("button", { name: "仕事", exact: true }).click();
      await page.reload();
      await expect(filter.getByRole("button", { name: "買い物", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    await page.screenshot({
      path: testInfo.outputPath("todo-default-shopping.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "ホーム", exact: true }).click();
    await expect(filter.getByRole("button", { name: "買い物", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await filter.getByRole("button", { name: "すべて", exact: true }).click();
    await page.getByRole("button", { name: "ToDo", exact: true }).click();
    await expect(filter.getByRole("button", { name: "買い物", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.goto("/settings");
    await select.selectOption({ label: "未分類" });
    await page.goto("/todos");
    await expect(filter.getByRole("button", { name: "未分類", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.goto("/settings");
    await select.selectOption({ label: "すべて" });
    await page.goto("/");
    await expect(filter.getByRole("button", { name: "すべて", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
);
test(
  "persists the browser's ToDo undo delay and uses it on home and ToDo pages",
  { tag: ["@todos", "@home", "@settings"] },
  async ({ page, context, browser }, testInfo) => {
    await authenticate(context, todoDelayToken);
    await page.goto("/settings");
    const select = page.getByRole("combobox", { name: "ToDo完了の取り消し猶予" });
    const chooseDelay = async (seconds: number) => {
      await select.selectOption(String(seconds * 1_000));
      await expect(select).toHaveValue(String(seconds * 1_000));
    };
    await expect(select).toHaveValue("3000");
    await expect(select.locator("option")).toHaveText(["1秒", "2秒", "3秒", "4秒", "5秒"]);
    // Existing browser profiles can still hold a fractional-second slider setting.
    await page.evaluate(() => localStorage.setItem("kaji:todo-completion-delay-ms:v1", "1700"));
    await page.reload();
    await expect(select).toHaveValue("2000");
    if (testInfo.project.name === "desktop") {
      const teamName = page.getByRole("textbox", { name: "チーム名", exact: true });
      const initialCategory = page.getByRole("combobox", { name: "最初に表示するToDoカテゴリー" });
      await expect(initialCategory).toBeEnabled();
      await teamName.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(initialCategory).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(select).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(initialCategory).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(teamName).toBeFocused();
    }
    await chooseDelay(1);
    await chooseDelay(2);
    await chooseDelay(5);
    await page.reload();
    await expect(select).toHaveValue("5000");
    await expect(page.getByText("別の端末やブラウザーには引き継がれません。")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("todo-delay-settings.png"), fullPage: true });

    // A separate browser profile for the same account must keep the default.
    const otherContext = await browser.newContext({ baseURL: "http://localhost:5194" });
    try {
      await authenticate(otherContext, todoDelayToken);
      const otherPage = await otherContext.newPage();
      await otherPage.goto("/settings");
      await expect(otherPage.getByRole("combobox", { name: "ToDo完了の取り消し猶予" })).toHaveValue(
        "3000",
      );
    } finally {
      await otherContext.close();
    }

    await page.getByRole("button", { name: "ToDo", exact: true }).click();
    for (const name of ["猶予検証ホーム", "猶予検証ToDo"]) {
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await page.getByLabel("名前", { exact: true }).fill(name);
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/_serverFn/") &&
          (response.request().postData()?.includes("postTodoItem") ?? false),
      );
      await page.getByRole("button", { name: "追加する", exact: true }).click();
      expect((await saved).ok()).toBe(true);
    }
    await page.getByRole("button", { name: "ホーム", exact: true }).click();
    const homeItem = page.getByRole("listitem").filter({ hasText: "猶予検証ホーム" });
    let completions = 0;
    page.on("request", (request) => {
      if (request.url().includes("/_serverFn/") && request.postData()?.includes("deleteTodoItem"))
        completions += 1;
    });
    await homeItem.getByRole("button", { name: "完了にする", exact: true }).click();
    await expect(homeItem.getByRole("img", { name: "完了まで5秒" })).toBeVisible();
    await homeItem.getByRole("button", { name: "取り消す", exact: true }).click();
    await page.waitForTimeout(5_100);
    expect(completions).toBe(0);
    await page.goto("/settings");
    await chooseDelay(1);
    await page.reload();
    await expect(select).toHaveValue("1000");
    for (const [route, name] of [
      ["ホーム", "猶予検証ホーム"],
      ["ToDo", "猶予検証ToDo"],
    ]) {
      await page.getByRole("button", { name: route, exact: true }).click();
      const item = page.getByRole("listitem").filter({ hasText: name });
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/_serverFn/") &&
          (response.request().postData()?.includes("deleteTodoItem") ?? false),
      );
      await item.getByRole("button", { name: "完了にする", exact: true }).click();
      await expect(item.getByRole("img", { name: "完了まで1秒" })).toBeVisible();
      expect((await saved).ok()).toBe(true);
      await page.reload();
      await expect(page.getByRole("region", { name: "ToDo一覧", exact: true })).toBeVisible();
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
    expect(completions).toBe(2);
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
    await expect(
      page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute("content", "black-translucent");
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
  "completed home cards release their animation layer before opening todo",
  { tag: ["@home", "@tasks", "@todos"] },
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

    await page.getByRole("button", { name: "ToDo", exact: true }).click();
    await expect(page.getByRole("heading", { name: "ToDo", exact: true })).toBeVisible();
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
    await expect(page.getByText(/今月と来月以降の予定を表示します/)).toBeVisible();
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
      // リクエストをまだ送っていない段階で、完了表示と保存中表示が出る。
      await expect(card.getByRole("img")).toHaveAttribute("aria-label", "1回目: テストユーザー");
      await expect(card).toBeDisabled();
      const saving = page.getByRole("status", { name: "保存中", exact: true });
      await expect(saving).toBeVisible();
      await expect(saving).toHaveText("");
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
    await expect(editor.getByLabel("週の必要回数")).toHaveValue("3");
    await expect(editor.getByText(/回数の変更は翌週月曜から適用/)).toBeVisible();
    await editor.getByLabel("週の必要回数").selectOption("1");
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
  { tag: ["@realtime", "@tasks", "@todos"] },
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

      await page.getByRole("button", { name: "ToDo", exact: true }).click();
      await peer.getByRole("button", { name: "ToDo", exact: true }).click();
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await page.getByPlaceholder("例: 牛乳", { exact: true }).fill("リアルタイムのToDo");
      await page.getByRole("button", { name: "追加する", exact: true }).click();
      await expect(peer.getByText("リアルタイムのToDo", { exact: true })).toBeVisible();
      const item = peer.getByRole("listitem").filter({ hasText: "リアルタイムのToDo" });
      await item.getByRole("button", { name: "編集", exact: true }).click();
      await peer.getByLabel("メモ", { exact: true }).fill("共有メモ");
      await peer.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page.getByText("共有メモ", { exact: true })).toBeVisible();
      await item.getByRole("button", { name: "完了にする" }).click();
      await expect(peer.getByRole("dialog", { name: "完了にしますか？" })).toHaveCount(0);
      await expect(item.getByRole("button", { name: "取り消す", exact: true })).toBeVisible();
      await expect(page.getByText("リアルタイムのToDo", { exact: true })).toBeVisible();
      await expect(page.getByText("リアルタイムのToDo", { exact: true })).toHaveCount(0);
      expect(connections).toBe(1);

      await page.goto("/tasks");
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await page.getByLabel("タスク名", { exact: true }).fill("リアルタイムの日間");
      await page.getByRole("button", { name: "追加する", exact: true }).click();
      await page.getByRole("button", { name: "ホーム", exact: true }).click();
      await peer.getByRole("button", { name: "ホーム", exact: true }).click();
      const taskA = page.getByRole("button", { name: /リアルタイムの日間.*日間/ });
      const taskB = peer.getByRole("button", { name: /リアルタイムの日間.*日間/ });
      await taskA.click();
      await expect(taskB.getByRole("img")).toHaveAttribute("aria-label", "1回目: テストユーザー");
      await taskB.click();
      await expect(taskA.getByRole("img")).toHaveAttribute("aria-label", "1回目: 未完了");
      await expect(outsider.getByText("リアルタイムの日間", { exact: true })).toHaveCount(0);
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

test(
  "ToDo categories persist, filter and detach without deleting items",
  { tag: ["@todos", "@home"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context);
    let category = `分類検証-${testInfo.project.name}`;
    await page.goto("/todo-categories");
    await page.getByLabel("新しいカテゴリー").fill(category);
    await page.getByRole("button", { name: "カテゴリーを追加", exact: true }).click();
    await expect(page.getByRole("button", { name: `${category} を削除` })).toBeVisible();
    await page.goto("/todos");
    await expect(page).toHaveURL(/\/todos$/);
    await page.getByRole("button", { name: "追加", exact: true }).click();
    const createDialog = page.getByRole("dialog", { name: "ToDoを追加" });
    const nameInput = createDialog.getByLabel("名前", { exact: true });
    const notesInput = createDialog.getByLabel("メモ", { exact: true });
    await expect(nameInput).toBeFocused();
    for (const [name, value] of [
      ["分類テストA", category],
      ["分類テスト未分類", ""],
      ["分類テストB", category],
    ]) {
      await nameInput.fill(name);
      if (name === "分類テストA") await notesInput.fill("最初のToDoだけのメモ");
      await page.getByLabel("カテゴリー（任意）").selectOption({ label: value || "未分類" });
      const selectedCategory = await page.getByLabel("カテゴリー（任意）").inputValue();
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/_serverFn/") &&
          (response.request().postData()?.includes("postTodoItem") ?? false),
      );
      if (name === "分類テストA") {
        await createDialog.getByRole("button", { name: "続けて追加", exact: true }).click();
      } else if (name === "分類テスト未分類") {
        await nameInput.press("Enter");
      } else {
        await createDialog.getByRole("button", { name: "追加する", exact: true }).click();
      }
      expect((await saved).ok()).toBe(true);
      await expect(page.getByText(name, { exact: true })).toBeVisible();
      if (name !== "分類テストB") {
        await expect(createDialog).toBeVisible();
        await expect(nameInput).toHaveValue("");
        await expect(nameInput).toBeFocused();
        await expect(notesInput).toHaveValue("");
        await expect(page.getByLabel("カテゴリー（任意）")).toHaveValue(selectedCategory);
        await expect(createDialog.getByRole("status")).toHaveText(`「${name}」を追加しました`);
        expect(
          await createDialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        if (name === "分類テストA") {
          await page.screenshot({ path: testInfo.outputPath("todos-continuous-add.png") });
        }
      }
    }
    await expect(createDialog).toHaveCount(0);
    const filter = page.getByRole("group", { name: "カテゴリーで絞り込み" });
    const verifyCategorySwipes = async (checkPageScroll = false) => {
      const cdp = await context.newCDPSession(page);
      const swipe = async (target: Locator, dx: number, dy = 0) => {
        await target.evaluate((element) =>
          element.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        const box = (await target.boundingBox())!;
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...start, id: 1 }],
        });
        for (let step = 1; step <= 6; step++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: start.x + (dx * step) / 6, y: start.y + (dy * step) / 6, id: 1 }],
          });
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
      const content = () => page.getByRole("listitem").filter({ hasText: "分類テスト" }).first();
      try {
        await filter.getByRole("button", { name: "すべて", exact: true }).click();
        const names = await filter.getByRole("button").allTextContents();
        // The tab row retains native horizontal scrolling, without changing selection.
        await swipe(filter, -100);
        await expect
          .poll(() => filter.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        await expect(filter.getByRole("button", { name: "すべて", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        for (let index = 1; index < names.length; index++) {
          const target =
            (await content().count()) > 0
              ? content()
              : page.getByText("このカテゴリーのToDoはありません。", { exact: true });
          await swipe(target, -100);
          const selected = filter.getByRole("button", { name: names[index], exact: true });
          await expect(selected).toHaveAttribute("aria-pressed", "true");
          const rowBox = (await filter.boundingBox())!;
          const selectedBox = (await selected.boundingBox())!;
          expect(selectedBox.x).toBeGreaterThanOrEqual(rowBox.x - 1);
          expect(selectedBox.x + selectedBox.width).toBeLessThanOrEqual(
            rowBox.x + rowBox.width + 1,
          );
        }
        await swipe(page.getByText("このカテゴリーのToDoはありません。", { exact: true }), -100);
        await expect(
          filter.getByRole("button", { name: names.at(-1)!, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await swipe(page.getByText("このカテゴリーのToDoはありません。", { exact: true }), 100);
        await expect(
          filter.getByRole("button", { name: names.at(-2)!, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await filter.getByRole("button", { name: "すべて", exact: true }).click();
        await content().evaluate((element) =>
          element.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        const beforeScroll = await page.evaluate(() => window.scrollY);
        await swipe(content(), 0, 80);
        await expect(filter.getByRole("button", { name: "すべて", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        if (checkPageScroll) {
          expect(beforeScroll).toBeGreaterThan(0);
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(beforeScroll);
        }
      } finally {
        await cdp.detach();
      }
    };
    await filter.getByRole("button", { name: category, exact: true }).click();
    await expect(page.getByText("分類テスト未分類", { exact: true })).toHaveCount(0);
    const reorderFilteredItems = async () => {
      const handle = page.getByRole("button", { name: "分類テストB をドラッグして並び替え" });
      // Keep both cards away from the viewport edge so drag auto-scroll does not shift the target.
      await handle.evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      const from = await handle.boundingBox();
      const to = await page
        .getByRole("button", { name: "分類テストA をドラッグして並び替え" })
        .boundingBox();
      if (!from || !to) throw new Error("ToDo drag handles are not visible");
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 10, { steps: 5 });
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/_serverFn/") &&
          (response.request().postData()?.includes("postTodoItemsReorder") ?? false),
      );
      await page.mouse.up();
      expect((await saved).ok()).toBe(true);
    };
    await reorderFilteredItems();
    await page.reload();
    await expect(
      page.getByRole("button", { name: /分類テスト.*をドラッグして並び替え/ }),
    ).toHaveCount(3);
    expect(
      await page
        .getByRole("button", { name: /分類テスト.*をドラッグして並び替え/ })
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label"))),
    ).toEqual([
      "分類テストA をドラッグして並び替え",
      "分類テスト未分類 をドラッグして並び替え",
      "分類テストB をドラッグして並び替え",
    ]);
    await page.screenshot({ path: testInfo.outputPath("todos-categories.png"), fullPage: true });
    await page.getByRole("button", { name: "その他", exact: true }).click();
    await page.getByRole("button", { name: "カテゴリー", exact: true }).click();
    await expect(page).toHaveURL(/\/todo-categories$/);
    await expect(page.getByRole("heading", { name: "カテゴリー管理" })).toBeVisible();
    await page.getByRole("button", { name: `${category} を編集`, exact: true }).click();
    category = `名前変更-${testInfo.project.name}`;
    await page.getByLabel("カテゴリー名", { exact: true }).fill(category);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "カテゴリー名を変更" })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: `${category} を編集`, exact: true }),
    ).toBeVisible();
    await page.getByLabel("新しいカテゴリー").fill("0件のカテゴリー");
    await page.getByRole("button", { name: "カテゴリーを追加", exact: true }).click();
    await expect(page.getByRole("button", { name: "0件のカテゴリー を削除" })).toBeVisible();
    const extraCategories = [
      "買い物リスト",
      "やることリスト",
      "家のメンテナンス",
      "手続き・予約",
      "週末のお出かけ",
      "あとで確認すること",
    ];
    for (const name of extraCategories) {
      await page.getByLabel("新しいカテゴリー").fill(name);
      await page.getByRole("button", { name: "カテゴリーを追加", exact: true }).click();
      await expect(page.getByRole("button", { name: `${name} を削除` })).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath("todo-category-management.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "ToDo", exact: true }).click();
    await expect(page.getByLabel("新しいカテゴリー")).toHaveCount(0);
    await expect(filter.getByRole("button", { name: "すべて", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const headingBox = await page.getByRole("heading", { name: "現在のToDo" }).boundingBox();
    const filterBox = await filter.boundingBox();
    expect(headingBox && filterBox && filterBox.y >= headingBox.y + headingBox.height).toBeTruthy();
    if (testInfo.project.name === "mobile") {
      expect(await filter.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await filter.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      expect(await filter.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await verifyCategorySwipes();
    }
    await filter.getByRole("button", { name: "あとで確認すること", exact: true }).click();
    await expect(page.getByText("このカテゴリーのToDoはありません。")).toBeVisible();
    await filter.getByRole("button", { name: "すべて", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath("todos-category-tabs.png"),
      fullPage: false,
    });
    await page.goto("/");
    await expect(filter.getByRole("button", { name: category, exact: true })).toBeVisible();
    await filter.getByRole("button", { name: "未分類", exact: true }).click();
    await expect(page.getByText("分類テスト未分類", { exact: true })).toBeVisible();
    await expect(page.getByText("分類テストA", { exact: true })).toHaveCount(0);
    await filter.getByRole("button", { name: "0件のカテゴリー", exact: true }).click();
    await expect(page.getByText("このカテゴリーのToDoはありません。")).toBeVisible();
    await filter.getByRole("button", { name: category, exact: true }).click();
    await expect(page.getByText("分類テストA", { exact: true })).toBeVisible();
    await expect(page.getByText("分類テストB", { exact: true })).toBeVisible();
    await expect(page.getByText("分類テスト未分類", { exact: true })).toHaveCount(0);
    if (testInfo.project.name === "mobile") {
      expect(await filter.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await verifyCategorySwipes(true);
      await filter.getByRole("button", { name: category, exact: true }).click();
    }
    await reorderFilteredItems();
    await page.reload();
    await expect(
      page.getByRole("button", { name: /分類テスト.*をドラッグして並び替え/ }),
    ).toHaveCount(3);
    expect(
      await page
        .getByRole("button", { name: /分類テスト.*をドラッグして並び替え/ })
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label"))),
    ).toEqual([
      "分類テストB をドラッグして並び替え",
      "分類テスト未分類 をドラッグして並び替え",
      "分類テストA をドラッグして並び替え",
    ]);
    await filter.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("home-category-tabs.png"), fullPage: false });

    await page.getByRole("button", { name: "その他", exact: true }).click();
    await page.getByRole("button", { name: "カテゴリー", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "0件のカテゴリー を削除" })).toBeVisible();
    await page.getByRole("button", { name: `${category} を削除` }).click();
    await expect(page.getByRole("button", { name: `${category} を削除` })).toHaveCount(0);
    await page.getByRole("button", { name: "ToDo", exact: true }).click();
    await filter.getByRole("button", { name: "未分類", exact: true }).click();
    await expect(page.getByText("分類テストA", { exact: true })).toBeVisible();
    await expect(page.getByText("分類テストB", { exact: true })).toBeVisible();
    await page.goto("/");
    const item = page.getByRole("listitem").filter({ hasText: "分類テストA" });
    await expect(item.getByText("未分類", { exact: true })).toBeVisible();
    let completionRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/_serverFn/") && request.postData()?.includes("deleteTodoItem")) {
        completionRequests += 1;
      }
    });
    await item.getByRole("button", { name: "完了にする", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "完了にしますか？" })).toHaveCount(0);
    await expect(item.getByText("完了待ち", { exact: true })).toBeVisible();
    await expect(item.getByRole("img", { name: "完了まで3秒" })).toBeVisible();
    await expect(page.getByRole("region", { name: "ToDoの完了待ち" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("todo-completion-undo.png") });
    await item.getByRole("button", { name: "取り消す", exact: true }).click();
    // Wait beyond the undo window to prove the cancelled timer sends no request.
    await page.waitForTimeout(3_100);
    expect(completionRequests).toBe(0);
    await expect(item.getByRole("button", { name: "完了にする", exact: true })).toBeEnabled();
    await page.reload();
    await expect(item.getByText("分類テストA", { exact: true })).toBeVisible();
    const completed = page.waitForResponse(
      (response) =>
        response.url().includes("/_serverFn/") &&
        (response.request().postData()?.includes("deleteTodoItem") ?? false),
    );
    await item.getByRole("button", { name: "完了にする", exact: true }).click();
    await page.getByRole("button", { name: "ToDo", exact: true }).click();
    await expect(item.getByRole("button", { name: "取り消す", exact: true })).toBeVisible();
    expect((await completed).ok()).toBe(true);
    expect(completionRequests).toBe(1);
    await expect(page.getByText("ToDoを完了しました", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("分類テストA", { exact: true })).toHaveCount(0);
    await expect(page.getByText("分類テストB", { exact: true })).toBeVisible();
  },
);

test.describe("ToDo swipe hit area", () => {
  test.use({ hasTouch: true });

  test(
    "switches categories from blank space with one or zero ToDos",
    { tag: ["@todos", "@home"] },
    async ({ page, context }, testInfo) => {
      await authenticate(context, swipeAreaToken);
      await page.goto("/todo-categories");
      for (const category of ["スワイプ用", "空のカテゴリー"]) {
        await page.getByLabel("新しいカテゴリー").fill(category);
        await page.getByRole("button", { name: "カテゴリーを追加", exact: true }).click();
        await expect(page.getByRole("button", { name: `${category} を削除` })).toBeVisible();
      }
      await page.goto("/todos");
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await page.getByLabel("名前", { exact: true }).fill("1件のToDo");
      await page.getByLabel("カテゴリー（任意）").selectOption({ label: "スワイプ用" });
      await page.getByRole("button", { name: "追加する", exact: true }).click();
      await expect(page.getByText("1件のToDo", { exact: true })).toBeVisible();

      const filter = page.getByRole("group", { name: "カテゴリーで絞り込み" });
      const region = page.getByRole("region", { name: "ToDo一覧", exact: true });
      const cdp = await context.newCDPSession(page);
      const blankPoint = async (content: Locator, fillViewport = false) => {
        await content.evaluate((element) =>
          element.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        const contentBox = (await content.boundingBox())!;
        const regionBox = (await region.boundingBox())!;
        // Start well below the rendered item/empty message, on the visible blank background.
        const point = {
          x: regionBox.x + regionBox.width / 2,
          y: contentBox.y + contentBox.height + 80,
        };
        if (fillViewport) {
          const addButtonBox = (await page
            .getByRole("button", { name: "追加", exact: true })
            .boundingBox())!;
          point.y = Math.max(point.y, addButtonBox.y - 80);
        }
        expect(regionBox.y + regionBox.height).toBeGreaterThan(point.y);
        expect(
          await region.evaluate(
            (element, { x, y }) => document.elementFromPoint(x, y) === element,
            point,
          ),
        ).toBe(true);
        return point;
      };
      const swipe = async (start: { x: number; y: number }, dx: number, dy = 0) => {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...start, id: 1 }],
        });
        for (let step = 1; step <= 6; step++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: start.x + (dx * step) / 6, y: start.y + (dy * step) / 6, id: 1 }],
          });
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
      try {
        for (const route of ["/todos", "/"]) {
          await page.goto(route);
          await filter.getByRole("button", { name: "スワイプ用", exact: true }).click();
          const item = region.getByRole("listitem");
          await expect(item).toHaveCount(1);
          await expect(item.getByText("1件のToDo", { exact: true })).toBeVisible();
          const start = await blankPoint(item, route === "/todos");
          await page.screenshot({
            path: testInfo.outputPath(route === "/" ? "home-one-todo.png" : "todos-one-todo.png"),
          });
          await swipe(start, -100);
          await expect(
            filter.getByRole("button", { name: "空のカテゴリー", exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
          await expect(item).toHaveCount(0);
          const empty = region.getByText("このカテゴリーのToDoはありません。", { exact: true });
          await expect(empty).toBeVisible();
          await swipe(await blankPoint(empty, route === "/todos"), 100);
          await expect(
            filter.getByRole("button", { name: "スワイプ用", exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
          await expect(item.getByText("1件のToDo", { exact: true })).toBeVisible();
          if (route === "/") {
            const scrollStart = await blankPoint(item);
            const { before, maximum } = await page.evaluate(() => ({
              before: window.scrollY,
              maximum: document.documentElement.scrollHeight - window.innerHeight,
            }));
            await swipe(scrollStart, 0, before > 0 ? 80 : -80);
            if (maximum > 0) {
              if (before > 0) {
                await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before);
              } else {
                await expect
                  .poll(() => page.evaluate(() => window.scrollY))
                  .toBeGreaterThan(before);
              }
            }
            await expect(
              filter.getByRole("button", { name: "スワイプ用", exact: true }),
            ).toHaveAttribute("aria-pressed", "true");
          }
        }
      } finally {
        await cdp.detach();
      }
    },
  );
});

test(
  "persists category order including unclassified with mouse, touch and keyboard",
  { tag: ["@todos", "@home"] },
  async ({ page, context, isMobile }, testInfo) => {
    await authenticate(context, categoryOrderToken);
    await page.goto("/todo-categories");
    const order = page.getByRole("list", { name: "カテゴリーの表示順" });
    for (const category of ["仕事", "買い物"]) {
      await page.getByLabel("新しいカテゴリー").fill(category);
      await page.getByRole("button", { name: "カテゴリーを追加" }).click();
      await expect(order.getByRole("button", { name: `${category} を削除` })).toBeVisible();
    }
    const dragHandle = (name: string) =>
      order.getByRole("button", { name: `${name} をドラッグして並び替え`, exact: true });
    const expectOrder = async (names: string[]) => {
      await expect
        .poll(async () =>
          order
            .getByRole("button", { name: /をドラッグして並び替え/ })
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
        )
        .toEqual(names.map((name) => `${name} をドラッグして並び替え`));
    };
    const waitForSave = () =>
      page.waitForResponse(
        (response) =>
          response.url().includes("/_serverFn/") &&
          (response.request().postData()?.includes("postTodoCategoriesReorder") ?? false),
      );
    await expectOrder(["未分類", "仕事", "買い物"]);
    await order.scrollIntoViewIfNeeded();
    const from = (await dragHandle("未分類").boundingBox())!;
    const to = (await dragHandle("買い物").boundingBox())!;
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    if (isMobile) {
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...start, id: 1 }],
        });
        await expect(dragHandle("未分類")).toHaveAttribute("aria-pressed", "true");
        for (let step = 1; step <= 10; step++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: start.x, y: start.y + ((end.y - start.y) * step) / 10, id: 1 }],
          });
        }
        const saved = waitForSave();
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        expect((await saved).ok()).toBe(true);
      } finally {
        await cdp.detach();
      }
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, start.y + 10, { steps: 5 });
      await expect(dragHandle("未分類")).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(end.x, end.y, { steps: 15 });
      const saved = waitForSave();
      await page.mouse.up();
      expect((await saved).ok()).toBe(true);
    }
    await expectOrder(["仕事", "買い物", "未分類"]);
    await page.reload();
    await expectOrder(["仕事", "買い物", "未分類"]);
    // Keyboard moves a named category as well as the virtual row.
    await dragHandle("買い物").focus();
    await page.keyboard.press("Space", { delay: 100 });
    await expect(dragHandle("買い物")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowUp");
    await expect
      .poll(async () => {
        const shopping = await dragHandle("買い物").boundingBox();
        const work = await dragHandle("仕事").boundingBox();
        return shopping !== null && work !== null && shopping.y < work.y;
      })
      .toBe(true);
    const keyboardSaved = waitForSave();
    await page.keyboard.press("Space");
    expect((await keyboardSaved).ok()).toBe(true);
    await expectOrder(["買い物", "仕事", "未分類"]);
    await page.screenshot({ path: testInfo.outputPath("todo-category-order.png"), fullPage: true });

    for (const path of ["/", "/todos"]) {
      await page.goto(path);
      const tabs = page.getByRole("group", { name: "カテゴリーで絞り込み" });
      await expect(tabs.getByRole("button")).toHaveText(["すべて", "買い物", "仕事", "未分類"]);
    }
    await page.getByRole("button", { name: "追加", exact: true }).click();
    const select = page.getByRole("combobox", { name: "カテゴリー（任意）" });
    await expect(select.locator("option")).toHaveText(["買い物", "仕事", "未分類"]);
    await expect(select).toHaveValue("");
    await page.getByLabel("名前", { exact: true }).fill("順序変更後の未分類ToDo");
    await page.getByRole("button", { name: "追加する", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("group", { name: "カテゴリーで絞り込み" })
      .getByRole("button", { name: "未分類", exact: true })
      .click();
    await expect(page.getByText("順序変更後の未分類ToDo", { exact: true })).toBeVisible();
  },
);

test(
  "shares optimistic ToDo order across navigation, rolls back failure, and persists a retry",
  { tag: ["@todos", "@home"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context, performanceToken);
    await page.goto("/todos");
    for (const name of ["順序検証A", "順序検証B"]) {
      await page.getByRole("button", { name: "追加", exact: true }).click();
      await page.getByPlaceholder("例: 牛乳", { exact: true }).fill(name);
      const saved = page.waitForResponse(
        (response) => response.request().postData()?.includes('"postTodoItem"') ?? false,
      );
      await page.getByRole("button", { name: "追加する", exact: true }).click();
      expect((await saved).ok()).toBe(true);
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    const handles = page.getByRole("button", { name: /順序検証.*をドラッグして並び替え/ });
    const order = () =>
      handles.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label")),
      );
    const firstOrder = ["順序検証B をドラッグして並び替え", "順序検証A をドラッグして並び替え"];
    const nextOrder = [...firstOrder].reverse();
    const moveAFirst = async () => {
      const handle = page.getByRole("button", { name: "順序検証A をドラッグして並び替え" });
      await handle.focus();
      await page.keyboard.press("Space", { delay: 100 });
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("ArrowUp");
      // Animated coordinates can move before the actual drop target is updated.
      // Wait for the accessible announcement to confirm a different target before dropping.
      await expect
        .poll(async () => {
          const announcements = await page.getByRole("status").allTextContents();
          return announcements.some((message) => {
            const match = /^Draggable item (\S+) was moved over droppable area (\S+)\.$/.exec(
              message,
            );
            return match !== null && match[1] !== match[2];
          });
        })
        .toBe(true);
      await page.keyboard.press("Space");
    };
    await expect.poll(order).toEqual(firstOrder);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route("**/_serverFn/**", async (route) => {
      if (!route.request().postData()?.includes("postTodoItemsReorder")) return route.continue();
      requests++;
      await held;
      await route.abort("failed");
    });
    try {
      await moveAFirst();
      await expect.poll(() => requests).toBe(1);
      await expect.poll(order).toEqual(nextOrder);
      await page.getByRole("button", { name: "ホーム", exact: true }).click();
      await expect.poll(order).toEqual(nextOrder);
      await expect(handles.first()).toBeDisabled();
      await page.screenshot({
        path: testInfo.outputPath("todo-shared-optimistic-order.png"),
        fullPage: true,
      });
    } finally {
      release();
    }
    await expect.poll(order).toEqual(firstOrder);
    await expect(handles.first()).toBeEnabled();
    await page.unrouteAll({ behavior: "wait" });
    const saved = page.waitForResponse(
      (response) => response.request().postData()?.includes("postTodoItemsReorder") ?? false,
    );
    await moveAFirst();
    expect((await saved).ok()).toBe(true);
    await expect.poll(order).toEqual(nextOrder);
    await page.reload();
    await expect.poll(order).toEqual(nextOrder);
  },
);

test(
  "paints submission feedback during CPU-heavy audio encoding before immediate AI responses",
  { tag: ["@assist"] },
  async ({ page, context }) => {
    await authenticate(context, token);
    await installAssistMediaFixture(page);
    await installAssistEncodingLoad(page);
    let transcriptions = 0,
      turns = 0;
    await page.route("**/api/assist/transcribe", async (route) => {
      transcriptions++;
      expect((await readAssistAudioUpload(route.request())).wav.length).toBeGreaterThan(1000);
      await route.fulfill({ json: { transcript: "粒マスタードを追加して" } });
    });
    await page.route("**/api/assist/turn", async (route) => {
      turns++;
      await route.fulfill({
        json: {
          kind: "listed",
          transcript: "粒マスタードを追加して",
          replyText: "応答が完了しました。",
          items: [],
          total: 0,
        },
      });
    });
    await page.goto("/todos");
    await page.getByRole("button", { name: "アシスト", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "音声アシスト" });
    await dialog.getByRole("button", { name: "録音を開始", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    await page.evaluate(() => window.assistFixture.emit());
    await dialog.getByRole("button", { name: "停止して送信", exact: true }).click();
    await expect(dialog.getByText("応答が完了しました。")).toBeVisible();
    const observed = await page.evaluate(() => window.assistPaintFixture);
    console.log(JSON.stringify({ encodingFeedback: observed }));
    expect(observed.framesBeforeTranscribe).toBeGreaterThanOrEqual(3);
    expect(observed.workers).toBe(1);
    expect(transcriptions).toBe(1);
    expect(turns).toBe(1);
    expect(await page.evaluate(() => window.assistFixture.activeTracks)).toBe(0);
  },
);

test(
  "native audio worklet sends the complete beginning middle and end and preserves the full transcript",
  { tag: ["@assist"] },
  async ({ page, context }) => {
    await authenticate(context, token);
    await installNativeAssistAudioFixture(page);
    const transcript = "粒マスタードを追加して。レモンと牛乳も追加して。";
    let transcribed = 0,
      submitted = 0;
    await page.route("**/api/assist/transcribe", async (route) => {
      const { wav } = await readAssistAudioUpload(route.request());
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.readUInt16LE(22)).toBe(1);
      expect(wav.readUInt32LE(24)).toBe(16000);
      expect((wav.length - 44) / 32000).toBeGreaterThan(3.6);
      const labels: number[] = [];
      const count = (wav.length - 44) / 2;
      for (let start = 0; start + 1600 <= count; start += 1600) {
        const energies = [220, 440, 880].map((frequency) => {
          let real = 0,
            imaginary = 0;
          for (let index = 0; index < 1600; index++) {
            const sample = wav.readInt16LE(44 + (start + index) * 2) / 32768;
            const angle = (2 * Math.PI * frequency * index) / 16000;
            real += sample * Math.cos(angle);
            imaginary += sample * Math.sin(angle);
          }
          return Math.hypot(real, imaginary) / 1600;
        });
        const strongest = Math.max(...energies);
        if (strongest < 0.04) continue;
        const label = [220, 440, 880][energies.indexOf(strongest)];
        if (labels.at(-1) !== label) labels.push(label);
      }
      expect(labels).toEqual([220, 440, 880]);
      transcribed++;
      await route.fulfill({ json: { transcript } });
    });
    await page.route("**/api/assist/turn", async (route) => {
      expect(route.request().postDataJSON().transcript).toBe(transcript);
      submitted++;
      await route.fulfill({
        json: {
          kind: "listed",
          transcript,
          replyText: "ToDoは今ありません。",
          items: [],
          total: 0,
        },
      });
    });
    await page.goto("/todos");
    await page.getByRole("button", { name: "アシスト", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "音声アシスト" });
    await dialog.getByRole("button", { name: "録音を開始", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    await page.evaluate(() => window.assistNativeFixture.play());
    await dialog.getByRole("button", { name: "録音を停止", exact: true }).click();
    const input = dialog.getByRole("textbox", { name: "送信する内容" });
    await expect(input).toHaveValue(transcript);
    expect(transcribed).toBe(1);
    expect(submitted).toBe(0);
    expect(await page.evaluate(() => window.assistNativeFixture.stopped)).toBe(1);
    await dialog.getByRole("button", { name: "送信", exact: true }).click();
    await expect(dialog.getByText("ToDoは今ありません。")).toBeVisible();
    expect(submitted).toBe(1);
  },
);

test(
  "assist stops on request, reviews text and supports stop-and-send across repeated opens",
  { tag: ["@assist"] },
  async ({ page, context }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await authenticate(context, token);
    await installAssistMediaFixture(page);
    let recordings = 0,
      requests = 0;
    let releaseTranscription!: () => void;
    let transcriptionGate = Promise.resolve();
    let releaseTurn!: () => void;
    let turnGate = Promise.resolve();
    let failTranscription = false;
    await page.route("**/api/assist/transcribe", async (route) => {
      recordings++;
      expect((await readAssistAudioUpload(route.request())).wav.length).toBeGreaterThan(1000);
      await transcriptionGate;
      if (failTranscription) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({
        json: { transcript: recordings === 1 ? "買い物にナットを追加して" : "やることを教えて" },
      });
    });
    await page.route("**/api/assist/turn", async (route) => {
      requests++;
      const input = route.request().postDataJSON();
      expect(input.audioBase64).toBeUndefined();
      expect(input.transcript).toBe(requests === 1 ? "買い物に納豆を追加して" : "やることを教えて");
      await turnGate;
      const item = {
        id: "22222222-2222-4222-8222-222222222222",
        teamId: input.expectedTeamId,
        name: "音声確認の納豆",
        notes: null,
        categoryId: null,
        sortKey: 100,
        createdAt: "2026-10-23T00:00:00.000Z",
        updatedAt: "2026-10-23T00:00:00.000Z",
      };
      await route.fulfill({
        json:
          requests === 1
            ? {
                kind: "added",
                transcript: input.transcript,
                replyText: "買い物に納豆を追加しました。",
                items: [item],
              }
            : {
                kind: "listed",
                transcript: input.transcript,
                replyText: "ToDoは1件です。納豆です。",
                total: 1,
                items: [item],
              },
      });
    });
    await page.goto("/todos");
    await expect(page.getByRole("heading", { name: "現在のToDo" })).toBeVisible();
    const launcher = page.getByRole("button", { name: "アシスト", exact: true });
    const more = page.getByRole("button", { name: "その他", exact: true });
    const [assistSize, moreSize] = await Promise.all([launcher.boundingBox(), more.boundingBox()]);
    expect(assistSize!.width).toBe(62);
    expect(assistSize!.height).toBe(moreSize!.height);
    await launcher.click();
    const dialog = page.getByRole("dialog", { name: "音声アシスト" });
    const text = dialog.getByRole("textbox", { name: "送信する内容" });
    const microphone = dialog.getByRole("button", { name: "録音を開始", exact: true });
    await expect(dialog.getByRole("heading", { name: "何を追加しますか？" })).toBeVisible();
    await expect(text).toHaveValue("");
    expect(await page.evaluate(() => window.assistFixture.captureRequests)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("assist-idle.png"), fullPage: true });
    await page.evaluate(() => {
      window.assistFixture.holdPermission = true;
    });
    await microphone.click();
    const startingButton = dialog.getByRole("button", { name: "マイクを準備中", exact: true });
    await expect(startingButton).toBeDisabled();
    await expect(startingButton).toHaveAttribute("aria-busy", "true");
    await expect(startingButton.locator(".assist-spinner")).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText("マイクを準備しています");
    // Loading does not wait for the permission decision, and the UI already acknowledges the tap.
    await expect.poll(() => page.evaluate(() => window.assistFixture.workletLoaded)).toBe(true);
    expect(await page.evaluate(() => window.assistFixture.activeTracks)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("assist-starting.png"), fullPage: true });
    await page.evaluate(() => window.assistFixture.allowMicrophone());
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    await page.evaluate(() => window.assistFixture.emit());
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    expect(recordings).toBe(0);
    expect(requests).toBe(0);
    expect(await page.evaluate(() => window.assistFixture.activeTracks)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("assist-recording.png"), fullPage: true });
    transcriptionGate = new Promise<void>((resolve) => {
      releaseTranscription = resolve;
    });
    await dialog.getByRole("button", { name: "録音を停止", exact: true }).click();
    const transcriptionIcon = dialog.locator(".assist-transcribing .assist-spinner");
    await expect(transcriptionIcon).toBeVisible();
    await expect(dialog.locator("form")).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByRole("status")).toHaveText("文字にしています");
    await expect(dialog.getByRole("status")).toHaveClass("assist-sr-only");
    await expect(dialog.getByRole("button", { name: "送信", exact: true })).toBeDisabled();
    await expect(transcriptionIcon).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(transcriptionIcon).toHaveCSS("animation-name", "assist-spin");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({
      path: testInfo.outputPath("assist-transcribing.png"),
      fullPage: false,
    });
    releaseTranscription();
    await expect(text).toHaveValue("買い物にナットを追加して");
    await expect(transcriptionIcon).toHaveCount(0);
    await expect(text).toBeFocused();
    expect(await page.evaluate(() => window.assistFixture.activeTracks)).toBe(0);
    expect(requests).toBe(0);
    await text.fill(" ");
    await expect(dialog.getByRole("button", { name: "送信", exact: true })).toBeDisabled();
    await text.fill("買い物に納豆を追加して");
    await page.screenshot({ path: testInfo.outputPath("assist-review.png"), fullPage: true });
    expect(requests).toBe(0);
    await dialog.getByRole("button", { name: "送信", exact: true }).click();
    await expect(dialog.getByText("買い物に納豆を追加しました。")).toBeVisible();
    await expect(text).toHaveValue("");
    expect(requests).toBe(1);
    await microphone.click();
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    await page.evaluate(() => window.assistFixture.emit());
    expect(requests).toBe(1);
    transcriptionGate = new Promise<void>((resolve) => {
      releaseTranscription = resolve;
    });
    turnGate = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    await dialog.getByRole("button", { name: "停止して送信", exact: true }).click();
    const pendingAudio = dialog.getByRole("group", { name: "送信を準備している音声" });
    await expect(pendingAudio).toBeVisible();
    await expect(dialog.locator(".assist-thinking")).toBeVisible();
    await expect(dialog.getByText("買い物に納豆を追加しました。")).toHaveCount(0);
    const submittingButton = dialog.getByRole("button", { name: "送信を準備中", exact: true });
    await expect(submittingButton).toBeDisabled();
    await expect(submittingButton.locator(".assist-spinner")).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText(
      "音声を受け付けました。文字起こし後に送信します",
    );
    await expect(transcriptionIcon).toHaveCount(0);
    expect(requests).toBe(1);
    await page.screenshot({
      path: testInfo.outputPath("assist-submitting-audio.png"),
      fullPage: true,
    });
    releaseTranscription();
    await expect(dialog.locator(".assist-user-message")).toHaveText("やることを教えて");
    await expect(pendingAudio).toHaveCount(0);
    const processingButton = dialog.getByRole("button", { name: "処理中", exact: true });
    await expect(processingButton.locator(".assist-spinner")).toBeVisible();
    await expect(dialog.locator(".assist-thinking")).toBeVisible();
    releaseTurn();
    await expect(dialog.getByText("音声確認の納豆", { exact: true })).toBeVisible();
    await expect(transcriptionIcon).toHaveCount(0);
    await expect(text).toHaveValue("");
    expect(recordings).toBe(2);
    expect(requests).toBe(2);
    expect(await page.evaluate(() => window.assistFixture.flushes)).toBe(2);
    expect(await page.evaluate(() => window.assistFixture.spoken)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("assist-result.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await launcher.click();
    await expect(text).toHaveValue("");
    expect(await page.evaluate(() => window.assistFixture.captureRequests)).toBe(2);
    await microphone.click();
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    await page.evaluate(() => window.assistFixture.emit());
    await dialog.getByRole("button", { name: "録音を停止", exact: true }).click();
    await expect(text).toHaveValue("やることを教えて");
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(i % 2 === 0 ? "Tab" : "Shift+Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(requests).toBe(2);
    await launcher.click();
    await microphone.click();
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    expect(await page.evaluate(() => window.assistFixture.captureRequests)).toBe(4);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.assistFixture.activeTracks)).toBe(0);
    expect(new URL(page.url()).pathname).toBe("/todos");
    // A failed transcription clears the optimistic message, retains the draft and never runs a turn.
    failTranscription = true;
    transcriptionGate = new Promise<void>((resolve) => {
      releaseTranscription = resolve;
    });
    await launcher.click();
    await text.fill("残す下書き");
    await microphone.click();
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    await page.evaluate(() => window.assistFixture.emit());
    await dialog.getByRole("button", { name: "停止して送信", exact: true }).click();
    await expect(pendingAudio).toBeVisible();
    releaseTranscription();
    await expect(dialog.getByRole("alert")).toContainText("文字にできませんでした");
    await expect(pendingAudio).toHaveCount(0);
    await expect(dialog.locator(".assist-thinking")).toHaveCount(0);
    await expect(text).toHaveValue("残す下書き");
    expect(requests).toBe(2);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await page.getByPlaceholder("例: 牛乳", { exact: true }).fill("入力途中");
    await expect(launcher).toBeDisabled();
    await expect(page.getByPlaceholder("例: 牛乳", { exact: true })).toHaveValue("入力途中");
  },
);

test(
  "assist help explains ToDo commands, bounded searches and completed results in a compact layout",
  { tag: ["@assist"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context, token);
    await installAssistMediaFixture(page);
    await page.route("**/api/assist/turn", async (route) => {
      const input = route.request().postDataJSON();
      if (input.transcript === "買い物の牛乳を探して") {
        await route.fulfill({
          json: {
            kind: "listed",
            transcript: input.transcript,
            replyText: "買い物の検索結果は23件です。",
            total: 23,
            items: Array.from({ length: 20 }, (_, index) => ({
              id: crypto.randomUUID(),
              teamId: input.expectedTeamId,
              name: `牛乳${index + 1}`,
              categoryId: null,
              notes: null,
              sortKey: index + 1,
              createdAt: "2026-10-25T00:00:00.000Z",
              updatedAt: "2026-10-25T00:00:00.000Z",
            })),
          },
        });
      } else if (input.transcript === "塩は購入した、レモンを追加して") {
        await route.fulfill({
          json: {
            kind: "batch",
            transcript: input.transcript,
            replyText: "2件完了しました。1件追加しました。",
            results: [
              {
                kind: "removed",
                action: "complete",
                count: 2,
                transcript: input.transcript,
                replyText: "2件完了しました。",
              },
              {
                kind: "added",
                transcript: input.transcript,
                replyText: "1件追加しました。",
                items: [
                  {
                    id: crypto.randomUUID(),
                    teamId: input.expectedTeamId,
                    name: "レモン",
                    categoryId: null,
                    notes: null,
                    sortKey: 100,
                    createdAt: "2026-10-25T00:00:00.000Z",
                    updatedAt: "2026-10-25T00:00:00.000Z",
                  },
                ],
              },
            ],
          },
        });
      } else {
        expect(input.transcript).toBe("牛乳を買った");
        await route.fulfill({
          json: {
            kind: "removed",
            action: "complete",
            count: 2,
            transcript: input.transcript,
            replyText: "2件完了しました。同じ名前のToDoをすべて対象にしました。",
          },
        });
      }
    });
    await page.goto("/todos");
    const launcher = page.getByRole("button", { name: "アシスト", exact: true });
    await launcher.click();
    const dialog = page.getByRole("dialog", { name: "音声アシスト" });
    const helpButton = dialog.getByRole("button", { name: "できること", exact: true });
    await helpButton.click();
    const help = dialog.getByRole("region", { name: "アシストでできること" });
    await expect(help).toBeVisible();
    await expect(help.getByText("「ToDoに牛乳と卵を追加して」")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("assist-help.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(helpButton).toBeFocused();
    await page.setViewportSize({ width: 320, height: 480 });
    await helpButton.click();
    const bounds = (await help.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(480);
    await helpButton.click();
    const text = dialog.getByRole("textbox", { name: "送信する内容" });
    const send = dialog.getByRole("button", { name: "送信", exact: true });
    await text.fill("買い物の牛乳を探して");
    await send.click();
    const results = dialog.getByLabel("ToDo 23件", { exact: true });
    await expect(results.getByRole("listitem")).toHaveCount(20);
    const notice = results.getByText(
      "全23件のうち先頭20件を表示しています。続きはToDo画面で確認してください。",
    );
    await notice.scrollIntoViewIfNeeded();
    await expect(notice).toBeVisible();
    await expect(notice).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("assist-search.png"), fullPage: false });
    await text.fill("牛乳を買った");
    await send.click();
    await expect(
      dialog.getByText("2件完了しました。同じ名前のToDoをすべて対象にしました。"),
    ).toBeVisible();
    await text.fill("塩は購入した、レモンを追加して");
    await send.click();
    await expect(dialog.getByText("2件完了しました。", { exact: true })).toBeVisible();
    await expect(dialog.getByText("1件追加しました。", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("assist-mixed.png"), fullPage: false });
    expect(await page.evaluate(() => window.assistFixture.captureRequests)).toBe(0);
    await dialog.getByRole("button", { name: "アシストを閉じる" }).click();
    await launcher.click();
    await expect(help).toBeHidden();
  },
);

test(
  "assist typed input needs no microphone and fits a compact viewport",
  { tag: ["@assist"] },
  async ({ page, context }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await authenticate(context, token);
    await installAssistMediaFixture(page);
    let requests = 0;
    await page.route("**/api/assist/turn", async (route) => {
      requests++;
      expect(route.request().postDataJSON().transcript).toBe("やることを教えて");
      await route.fulfill({
        json: {
          kind: "listed",
          transcript: "やることを教えて",
          replyText: "ToDoは今ありません。",
          items: [],
          total: 0,
        },
      });
    });
    await page.setViewportSize({ width: 320, height: 480 });
    await page.goto("/todos");
    await page.getByRole("button", { name: "アシスト", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "音声アシスト" });
    const text = dialog.getByRole("textbox", { name: "送信する内容" });
    await text.fill("長い入力".repeat(200));
    for (const control of [
      text,
      dialog.getByRole("button", { name: "送信", exact: true }),
      dialog.getByRole("button", { name: "アシストを閉じる" }),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(480);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
    await text.fill("やることを教えて");
    await dialog.getByRole("button", { name: "送信", exact: true }).click();
    await expect(dialog.getByText("ToDoは今ありません。")).toBeVisible();
    expect(requests).toBe(1);
    expect(await page.evaluate(() => window.assistFixture.captureRequests)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("assist-compact.png"), fullPage: false });
  },
);

test(
  "disabled assist releases recording and allows an explicit retry or exit",
  { tag: ["@assist"] },
  async ({ page, context, request }) => {
    await authenticate(context, token);
    await installAssistMediaFixture(page);
    const response = await request.post("/api/assist/turn", {
      headers: { origin: "http://localhost:5194" },
      data: {},
    });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "assist_disabled" });
    await page.goto("/");
    await page.getByRole("button", { name: "アシスト", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "音声アシスト" });
    await dialog.getByRole("button", { name: "録音を開始", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("録音中");
    await page.evaluate(() => window.assistFixture.emit());
    await dialog.getByRole("button", { name: "録音を停止", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "録音を開始", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByRole("alert")).toHaveText("音声アシストはまだ有効になっていません。");
    await expect(dialog.getByRole("status")).toHaveText("入力を確認してください");
    expect(await page.evaluate(() => window.assistFixture.stopped)).toBeGreaterThan(0);
  },
);
