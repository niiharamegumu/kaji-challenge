import { test, expect, type BrowserContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
const secret = "kaji-e2e-only-secret-do-not-use-in-production";
const userId = crypto.randomUUID(),
  token = crypto.randomUUID();
const peerToken = crypto.randomUUID(),
  outsiderToken = crypto.randomUUID();
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
    ]) {
      const id = crypto.randomUUID();
      await connection.query(
        sql`INSERT INTO auth_user(id,name,email) VALUES (${id},${name},${id + "@example.com"})`,
      );
      await provisionUser(connection.repository, id, new Date());
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
test("denied OAuth login shows an explanation and a way back to login", async ({ page }) => {
  await page.goto("/auth/callback?error=signup_forbidden");
  await expect(page.getByRole("heading", { name: "ログインできませんでした" })).toBeVisible();
  await expect(page.getByText(/このアカウントは現在の利用対象に登録されていません/)).toBeVisible();
  await expect(page.locator("#boot-splash")).toHaveCount(0);
  await page.getByRole("link", { name: "ログイン画面に戻る" }).click();
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
});
test("login screen and API paths never fall back to cached HTML", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
  const document = await request.get("/");
  expect(document.headers()["x-frame-options"]).toBe("DENY");
  expect(document.headers()["x-content-type-options"]).toBe("nosniff");
  const serviceWorker = await request.get("/sw.js");
  expect(serviceWorker.headers()["cache-control"]).toContain("no-store");
  const response = await request.get("/api/auth/get-session");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toBeNull();
});
test("existing identity loads every route and updates todo through Workers", async ({
  page,
  context,
}, testInfo) => {
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
});
test("keeps Japanese dates across browser timezones at the month boundary", async ({ browser }) => {
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
      await expect(page.locator(".fc-day-today")).toHaveAttribute("data-date", "2026-04-01");
      const aprilSecond = page.locator('.fc-daygrid-day[data-date="2026-04-02"]');
      await expect(aprilSecond.getByRole("button", { name: "4月2日(木)を選択" })).toBeVisible();
      await page.getByRole("button", { name: "次の月" }).click();
      await page.getByRole("button", { name: "今日", exact: true }).click();
      await expect(page.locator(".fc-day-today")).toHaveAttribute("data-date", "2026-04-01");
      await page.goto("/summary");
      await expect(page.getByRole("button", { name: "対象月を選択" })).toHaveText("2026年04月");
    } finally {
      await context.close();
    }
  }
});

test("PWA installs the generated SPA shell and excludes server functions", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    "content",
    "black-translucent",
  );
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
          (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
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
});

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

test("creates tasks, reorders with real drag sensors, and preserves navigation", async ({
  page,
  context,
}) => {
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
  await expect(dailyButton.getByRole("img")).toHaveAttribute("aria-label", "1回目: テストユーザー");
  await expect(dailyButton).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await expect(dailyButton.getByRole("img")).toHaveAttribute("aria-label", "1回目: テストユーザー");
  await dailyButton.click();
  await expect(dailyButton.getByRole("img")).toHaveAttribute("aria-label", "1回目: 未完了");
  await page.getByRole("button", { name: "カレンダー", exact: true }).click();
  await expect(page).toHaveURL(/calendar/);
  await page.goBack();
  await expect(page.getByText("操作確認A", { exact: true })).toBeVisible();
});

test("completed home cards release their animation layer before opening todo", async ({
  page,
  context,
}) => {
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
  await expect(page.locator('main [class*="ring-[color:var(--color-matcha-400)]"]')).toHaveCount(0);
});

test("uses the same calendar form shell for creation and editing and persists both", async ({
  page,
  context,
}, testInfo) => {
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
});

test("completion responds before a delayed request and rolls back when it fails", async ({
  page,
  context,
}) => {
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
    await expect(page.getByText("保存中…", { exact: true })).toBeVisible();
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
});

test("retains three weekly completions after stale refetch, summary navigation and reload", async ({
  page,
  context,
}) => {
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
    await expect(card.getByRole("button", { name: "週間3回の保持確認 を1増やす" })).toBeDisabled();
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
  await expect(page.getByText("週間3回の保持確認", { exact: true })).toBeVisible();
  // Expire the unmounted home cache, then fetch from the server again.
  await page.clock.fastForward(301000);
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await expectComplete();
  await page.reload();
  await expectComplete();
});

test("real WebSockets synchronize two users, deduplicate tabs and isolate teams", async ({
  browser,
  page,
  context,
}, testInfo) => {
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
    const item = peer.getByText("リアルタイムのToDo", { exact: true }).locator("..");
    await item.getByRole("button", { name: "編集", exact: true }).click();
    await peer.getByLabel("メモ", { exact: true }).fill("共有メモ");
    await peer.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("共有メモ", { exact: true })).toBeVisible();
    await item.getByRole("button", { name: "完了にする" }).click();
    await peer
      .getByRole("dialog", { name: "完了にしますか？" })
      .getByRole("button", { name: "完了にする", exact: true })
      .click();
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
});

test("ToDo categories persist, filter and detach without deleting items", async ({
  page,
  context,
}, testInfo) => {
  await authenticate(context);
  await page.goto("/todos");
  await expect(page).toHaveURL(/\/todos$/);
  const category = `分類検証-${testInfo.project.name}`;
  for (const [name, value] of [
    ["分類テストA", category],
    ["分類テスト未分類", ""],
    ["分類テストB", category],
  ]) {
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await page.getByLabel("名前", { exact: true }).fill(name);
    await page.getByLabel("カテゴリー（任意）").fill(value);
    await page.getByRole("button", { name: "追加する", exact: true }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  const filter = page.getByRole("group", { name: "カテゴリーで絞り込み" });
  await filter.getByRole("button", { name: category, exact: true }).click();
  await expect(page.getByText("分類テスト未分類", { exact: true })).toHaveCount(0);
  const handle = page.getByRole("button", { name: "分類テストB をドラッグして並び替え" });
  await handle.scrollIntoViewIfNeeded();
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
  await page.getByRole("button", { name: "カテゴリー管理", exact: true }).click();
  await expect(page).toHaveURL(/\/todo-categories$/);
  await expect(page.getByRole("heading", { name: "カテゴリー管理" })).toBeVisible();
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
  }
  await filter.getByRole("button", { name: "あとで確認すること", exact: true }).click();
  await expect(page.getByText("このカテゴリーのToDoはありません。")).toBeVisible();
  await filter.getByRole("button", { name: "すべて", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("todos-category-tabs.png"), fullPage: false });
  await page.getByRole("button", { name: "その他", exact: true }).click();
  await page.getByRole("button", { name: "カテゴリー管理", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "0件のカテゴリー を削除" })).toBeVisible();
  await page.getByRole("button", { name: `${category} を削除` }).click();
  await expect(page.getByRole("button", { name: `${category} を削除` })).toHaveCount(0);
  await page.getByRole("button", { name: "ToDo", exact: true }).click();
  await filter.getByRole("button", { name: "未分類", exact: true }).click();
  await expect(page.getByText("分類テストA", { exact: true })).toBeVisible();
  await expect(page.getByText("分類テストB", { exact: true })).toBeVisible();
  await page.goto("/");
  const item = page.getByText("分類テストA", { exact: true }).locator("..");
  await expect(item.getByText("未分類", { exact: true })).toBeVisible();
  const completed = page.waitForResponse(
    (response) =>
      response.url().includes("/_serverFn/") &&
      (response.request().postData()?.includes("deleteTodoItem") ?? false),
  );
  await item.getByRole("button", { name: "完了にする", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "完了にする", exact: true }).click();
  expect((await completed).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("分類テストA", { exact: true })).toHaveCount(0);
  await expect(page.getByText("分類テストB", { exact: true })).toBeVisible();
});
