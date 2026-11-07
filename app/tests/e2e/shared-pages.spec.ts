import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { SharedPageBlock } from "../../src/contracts/shared-pages";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";

const origin = "http://localhost:5194";
const secret = "kaji-e2e-only-secret-do-not-use-in-production";
const owner = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: "ページ担当" };
const peer = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: "ページの相手" };
const outsider = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: "ページ別チーム" };
const secondSessionToken = crypto.randomUUID();
const reorderPageId = crypto.randomUUID();

function pageBlock(
  type: SharedPageBlock["type"],
  name: string,
  children: SharedPageBlock[] = [],
): SharedPageBlock {
  return {
    id: crypto.randomUUID(),
    type,
    props: type === "checkListItem" ? { checked: true } : {},
    content: [{ type: "text", text: name, styles: {} }],
    children,
  };
}

test.beforeAll(async () => {
  const path = process.env.KAJI_D1_TEST_PATH;
  if (!path) throw new Error("Run browser tests via bun run test:local for isolated D1 storage");
  const connection = await createTestDatabase(path);
  try {
    for (const user of [owner, peer, outsider]) {
      await connection.query(
        sql`INSERT INTO auth_user(id,name,email) VALUES (${user.id},${user.name},${user.id + "@example.com"})`,
      );
      await provisionUser(connection.repository, user.id, new Date());
      await connection.query(
        sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${crypto.randomUUID()},${user.token},${user.id},strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))`,
      );
    }
    const teamId = (await connection.repository.ListMembershipsByUserID(owner.id))[0].TeamID;
    const sessionId = crypto.randomUUID();
    await connection.query(
      sql`UPDATE team_members SET team_id=${teamId},role='member' WHERE user_id=${peer.id}`,
    );
    await connection.query(
      sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${sessionId},${secondSessionToken},${owner.id},strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))`,
    );
    await connection.repository
      .forSession(owner.id, sessionId)
      .forMember(teamId, owner.id)
      .CreateSharedPage({
        id: reorderPageId,
        teamId,
        userId: owner.id,
        title: "旅の持ち物",
        document: {
          format: "blocknote",
          schemaVersion: 1,
          blocks: [
            pageBlock("heading", "旅", [
              pageBlock("checkListItem", "荷造り", [
                pageBlock("numberedListItem", "着替え", [pageBlock("bulletListItem", "靴下")]),
                pageBlock("bulletListItem", "雨具"),
              ]),
              pageBlock("bulletListItem", "交通"),
            ]),
            pageBlock("paragraph", "出発前のメモ"),
            pageBlock("bulletListItem", "予約"),
            pageBlock("numberedListItem", "出発"),
          ],
        },
      });
  } finally {
    // Browser interaction uses only the preview Worker's D1, never a second live emulator.
    await connection.close();
  }
});

async function authenticate(context: BrowserContext, token = owner.token) {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: encodeURIComponent(`${token}.${signature}`),
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

function operationResponse(page: Page, operation: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/_serverFn/") &&
      (response.request().postData()?.includes(`"${operation}"`) ?? false),
  );
}

async function saved(response: Promise<Response>) {
  const result = await response;
  expect(result.ok()).toBe(true);
  await result.finished();
  return result;
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "ページ本文", exact: true });
}

async function createPage(page: Page, title: string, body: string, checklist?: string) {
  await page.goto("/pages");
  await page.getByRole("link", { name: "ページを作成", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/new$/);
  await page.getByRole("textbox", { name: "タイトル", exact: true }).fill(title);
  await editor(page).fill(body);
  if (checklist) {
    await editor(page).press("End");
    await editor(page).press("Enter");
    await page.getByRole("button", { name: "ブロックを追加", exact: true }).click();
    await page.getByRole("button", { name: "チェックリスト", exact: true }).click();
    await page.keyboard.insertText(checklist);
    await expect(page.getByRole("checkbox")).toHaveCount(1);
  }
  const created = operationResponse(page, "postSharedPage");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await saved(created);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "編集する", exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function beginEditing(page: Page) {
  const acquired = operationResponse(page, "postSharedPageLease");
  await page.getByRole("button", { name: "編集する", exact: true }).click();
  await saved(acquired);
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
}

async function finishEditing(page: Page) {
  const released = operationResponse(page, "releaseSharedPageLease");
  await page.getByRole("button", { name: "編集を終了", exact: true }).click();
  const response = await saved(released);
  await expect(page.getByRole("button", { name: "編集する", exact: true })).toBeVisible();
  return response;
}

async function expectUnobscured(button: Locator) {
  await expect(button).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      button.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [0.2, 0.5, 0.8].every((ratio) => {
          const target = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height * ratio,
          );
          return target !== null && element.contains(target);
        });
      }),
    )
    .toBe(true);
}

test(
  "shared page creation uses the app theme and restores navigation after returning",
  { tag: ["@shared-pages", "@theme"] },
  async ({ page, context, isMobile }, testInfo) => {
    await authenticate(context);
    const viewport = page.viewportSize()!;
    const nav = page.getByTestId("floating-nav");
    const navBottomGap = () =>
      nav.evaluate((element) => window.innerHeight - element.getBoundingClientRect().bottom);

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/pages");
      await expect(nav).toBeVisible();
      const listHelp = page.getByRole("button", { name: "共有ページの使い方" });
      await expect(page.getByText("メモも、計画も、好きな形で。")).toHaveCount(0);
      await listHelp.click();
      const help = page.getByRole("dialog", { name: "共有ページの使い方" });
      await expect(help).toContainText("文章やチェックリスト");
      await page.screenshot({ path: testInfo.outputPath(`shared-page-info-${colorScheme}.png`) });
      await help.getByRole("button", { name: "閉じる" }).click();
      await expect(listHelp).toBeFocused();
      const originalGap = await navBottomGap();
      const canvas = await page.locator("body").evaluate((element) => {
        return getComputedStyle(element).backgroundColor;
      });
      await page.getByRole("link", { name: "ページを作成", exact: true }).click();
      await expect(editor(page)).toBeVisible();
      const createHelp = page.getByRole("button", { name: "ページ作成の説明" });
      await expect(page.getByText(/作成すると、同じチームのメンバーに共有/)).toHaveCount(0);
      await createHelp.click();
      await expect(page.getByRole("dialog", { name: "ページ作成の説明" })).toContainText(
        "同じチームのメンバーに共有",
      );
      await page.keyboard.press("Escape");
      await expect(createHelp).toBeFocused();
      const addBlock = page.getByRole("button", { name: "ブロックを追加", exact: true });
      const blockMenu = page.getByRole("group", { name: "追加するブロック", exact: true });
      await addBlock.click();
      await expect(blockMenu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(blockMenu).toHaveCount(0);
      await expect(addBlock).toBeFocused();
      await addBlock.click();
      await page.getByRole("textbox", { name: "タイトル", exact: true }).click();
      await expect(blockMenu).toHaveCount(0);
      // Editing must not replace the whole app's scroll/positioning context.
      await expect(page.locator("#root")).toHaveCSS("position", "static");
      const surface = isMobile
        ? canvas
        : colorScheme === "dark"
          ? "rgb(35, 39, 35)"
          : "rgb(255, 255, 255)";
      await expect(page.getByRole("article", { name: "共有ページ本文" })).toHaveCSS(
        "background-color",
        surface,
      );
      await expect(page.locator(".shared-page-toolbar")).toHaveCSS("background-color", surface);
      if (isMobile) {
        await expect(nav).toBeHidden();
        // A short page must fit the viewport without an extra screen-height + padding.
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight))
          .toBeLessThanOrEqual(1);
      }
      await page.screenshot({ path: testInfo.outputPath(`shared-page-new-${colorScheme}.png`) });
      await page.getByRole("textbox", { name: "タイトル", exact: true }).focus();
      await editor(page).focus();
      // Exercise a viewport change, without claiming to emulate an iPhone keyboard.
      await page.setViewportSize({ width: viewport.width, height: viewport.height - 250 });
      await page.getByRole("button", { name: "共有ページへ戻る", exact: true }).click();
      await expect(page).toHaveURL(/\/pages$/);
      await page.setViewportSize(viewport);
      await expect(nav).toBeVisible();
      await expect(page.locator("#root")).toHaveCSS("position", "static");
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.style.getPropertyValue("--bn-vv-height")),
        )
        .toBe("");
      await expect.poll(navBottomGap).toBeCloseTo(originalGap, 0);
      await expectUnobscured(nav.getByRole("button", { name: "ホーム", exact: true }));
      await page.screenshot({ path: testInfo.outputPath(`shared-page-return-${colorScheme}.png`) });
    }
  },
);

test(
  "erasing the only input on a new page leaves without warning or a recovery draft",
  { tag: ["@shared-pages"] },
  async ({ page, context }) => {
    await authenticate(context);
    await page.goto("/pages/new");
    await editor(page).click();
    await page.keyboard.insertText("字");
    await page.keyboard.press("Backspace");
    await expect(editor(page)).toHaveText("");
    await page.getByRole("button", { name: "共有ページへ戻る" }).click();
    await expect(page).toHaveURL(/\/pages\/?$/);
    await page.getByRole("link", { name: "ページを作成", exact: true }).click();
    await expect(editor(page)).toHaveAttribute("contenteditable", "true");
    await expect(
      page.getByText("このタブに未保存の入力が残っています。", { exact: false }),
    ).toHaveCount(0);
  },
);

test(
  "loads the sidebar only when visible and keeps handles aligned when edited text wraps",
  { tag: ["@shared-pages"] },
  async ({ page, context }) => {
    await authenticate(context);
    await page.setViewportSize({ width: 390, height: 800 });
    let listRequests = 0;
    page.on("request", (request) => {
      if (request.postData()?.includes('"listSharedPages"')) listRequests++;
    });
    await page.goto("/pages/new");
    await editor(page).fill("先頭");
    await editor(page).press("End");
    await editor(page).press("Enter");
    await page.keyboard.insertText("次の段落");
    const grip = (name: string) =>
      page.getByRole("button", { name: name + " をドラッグして並び替え", exact: true });
    await expect(grip("次の段落")).toBeVisible();
    expect(listRequests).toBe(0);

    const first = editor(page).getByText("先頭", { exact: true });
    await first.click();
    await page.keyboard.press("End");
    const extended = "先頭" + "折り返す文章".repeat(24);
    await page.keyboard.insertText(extended.slice(2));
    await expect(grip(extended.slice(0, 80))).toBeVisible();
    const next = editor(page).getByText("次の段落", { exact: true });
    const aligned = async () => {
      const row = await next.evaluate(
        (element) => element.closest(".bn-block-content")!.getBoundingClientRect().top,
      );
      return Math.abs((await grip("次の段落").boundingBox())!.y - row);
    };
    await expect.poll(aligned).toBeLessThan(2);
    const fetched = operationResponse(page, "listSharedPages");
    await page.setViewportSize({ width: 1200, height: 800 });
    await saved(fetched);
    await expect(page.getByRole("complementary", { name: "共有ページ一覧" })).toBeVisible();
    await expect.poll(aligned).toBeLessThan(2);
    await expect(editor(page)).toContainText(extended);
  },
);

test(
  "shared page toolbar stays reachable while scrolling a long page in read and edit modes",
  { tag: ["@shared-pages"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context);
    const title = `旅の長い計画 ${crypto.randomUUID().slice(0, 8)}`;
    const body = Array.from(
      { length: 64 },
      (_, index) =>
        `${index + 1}日目の相談。朝はゆっくり散歩して、気になったお店でごはんを食べる。午後の予定はふたりで話して決めよう。`,
    ).join(" ");
    await createPage(page, title, body);
    await expect(page.locator(".bn-editor")).toContainText("64日目の相談。");
    const viewportHeight = page.viewportSize()!.height;
    const scrollPage = async () => {
      // Exercise the actual scroll owner in both read and edit modes.
      const scrollContainer = await page.locator(".bn-editor").evaluateHandle((element) => {
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (
            /auto|scroll/.test(getComputedStyle(ancestor).overflowY) &&
            ancestor.scrollHeight > ancestor.clientHeight
          )
            return ancestor;
        }
        return document.scrollingElement ?? document.documentElement;
      });
      try {
        await scrollContainer.evaluate((element) =>
          element.scrollTo({ top: 0, behavior: "instant" }),
        );
        await page.mouse.move(page.viewportSize()!.width * 0.65, viewportHeight / 2);
        await page.mouse.wheel(0, viewportHeight * 2);
        await expect
          .poll(() => scrollContainer.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(viewportHeight);
      } finally {
        await scrollContainer.dispose();
      }
    };

    // Visibility alone does not detect a sticky application header covering the toolbar.
    // Check the current hit targets before clicking, so automatic scrolling cannot hide it.
    await scrollPage();
    await expectUnobscured(page.getByRole("button", { name: "編集する", exact: true }));
    await page.screenshot({ path: testInfo.outputPath("shared-page-scrolled-read.png") });
    await beginEditing(page);

    await scrollPage();
    await expectUnobscured(page.getByRole("button", { name: "編集を終了", exact: true }));
    await page.screenshot({ path: testInfo.outputPath("shared-page-scrolled-edit.png") });
    await finishEditing(page);
    await expect(page.locator(".bn-editor")).toContainText("64日目の相談。");
  },
);

test(
  "shared pages create, edit checklists, restore after a new login session and delete",
  { tag: ["@shared-pages"] },
  async ({ page, context, browser }, testInfo) => {
    await authenticate(context);
    const title = `ふたりの計画 ${crypto.randomUUID().slice(0, 8)}`;
    const body = "秋は京都でゆっくり過ごしたい。";
    const checklist = "宿を予約する";
    const pagePath = await createPage(page, title, body, checklist);
    await expect(page.locator(".bn-editor")).toContainText(body);
    const checkbox = page.getByRole("checkbox");
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("shared-page-read.png"), fullPage: true });

    await beginEditing(page);
    const status = page.locator(".shared-page-toolbar").getByRole("status");
    await expect(status).toHaveText("変更なし");
    let writes = 0;
    let release!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_serverFn/**", async (route) => {
      if (route.request().postData()?.includes('"patchSharedPage"')) {
        writes++;
        if (writes === 1) await firstWrite;
      }
      await route.continue();
    });
    const updatedTitle = `${title}・更新`;
    const checked = operationResponse(page, "patchSharedPage");
    try {
      await checkbox.check();
      await expect(status).toHaveText("未保存");
      await expect(status).toHaveText("保存中…");
      await page.getByRole("textbox", { name: "タイトル", exact: true }).fill(updatedTitle);
    } finally {
      release();
    }
    await saved(checked);
    // The first acknowledgment only covers the checkbox, not the newer title.
    await expect(status).toHaveText("未保存");
    await expect(status).toHaveText("保存済み");
    expect(writes).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("shared-page-edit.png"), fullPage: true });
    await finishEditing(page);
    expect(writes).toBe(2);
    await page.reload();
    await expect(page.getByRole("heading", { name: updatedTitle, exact: true })).toBeVisible();
    await expect(checkbox).toBeChecked();
    await expect(page.locator(".bn-editor")).toContainText(body);

    // A new browser context and a different valid session exercise server persistence,
    // independently of the first tab's Query cache and editor state.
    const loggedInAgain = await browser.newContext({ baseURL: origin });
    try {
      await authenticate(loggedInAgain, secondSessionToken);
      const reopened = await loggedInAgain.newPage();
      await reopened.goto(pagePath);
      await expect(
        reopened.getByRole("heading", { name: updatedTitle, exact: true }),
      ).toBeVisible();
      await expect(reopened.getByRole("checkbox")).toBeChecked();
      await expect(reopened.locator(".bn-editor")).toContainText(body);
    } finally {
      await loggedInAgain.close();
    }

    await page.getByRole("button", { name: "ページを削除", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toContainText("削除");
    await expect(confirmation).toContainText(updatedTitle);
    await page.screenshot({ path: testInfo.outputPath("shared-page-delete.png"), fullPage: true });
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deleteRequests = 0;
    await page.route("**/_serverFn/**", async (route) => {
      if (route.request().postData()?.includes('"deleteSharedPage"')) {
        deleteRequests++;
        await deleteGate;
      }
      return route.continue();
    });
    const deleted = operationResponse(page, "deleteSharedPage");
    try {
      await confirmation.getByRole("button", { name: "削除する", exact: true }).click();
      await expect.poll(() => deleteRequests).toBe(1);
      await expect(
        confirmation.getByRole("button", { name: "削除中…", exact: true }),
      ).toBeDisabled();
      await expect(
        confirmation.getByRole("button", { name: "削除中…", exact: true }),
      ).toHaveAttribute("aria-busy", "true");
      await expect(
        confirmation.getByRole("button", { name: "キャンセル", exact: true }),
      ).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath("shared-page-deleting.png") });
    } finally {
      releaseDelete();
    }
    await saved(deleted);
    await page.unrouteAll({ behavior: "wait" });
    await expect(page).toHaveURL(/\/pages\/?$/);
    await page.reload();
    await expect(page.getByText(updatedTitle, { exact: true })).toHaveCount(0);
  },
);

test(
  "left handles reorder every block type in the editor and preserve nested content after reload",
  { tag: ["@shared-pages"] },
  async ({ page, context, isMobile }, testInfo) => {
    await authenticate(context);
    if (isMobile) await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`/pages/${reorderPageId}`);
    const handles = page.getByRole("button", { name: /をドラッグして並び替え$/ });
    const grip = (name: string) =>
      page.getByRole("button", { name: `${name} をドラッグして並び替え`, exact: true });
    const rows = editor(page).locator(".bn-inline-content").filter({ hasText: /\S/ });
    const subtree = ["旅", "荷造り", "着替え", "靴下", "雨具", "交通"];
    const heading = editor(page).locator('.bn-block:has(> [data-content-type="heading"])');
    const checklist = editor(page).locator('.bn-block:has(> [data-content-type="checkListItem"])');
    const checkbox = checklist.getByRole("checkbox");
    await expect(rows).toHaveText([...subtree, "出発前のメモ", "予約", "出発"]);
    await expect(handles).toHaveCount(0);
    const headingId = await heading.getAttribute("data-id");
    await beginEditing(page);
    await expect(page.getByRole("button", { name: "リストを並び替え", exact: true })).toHaveCount(
      0,
    );
    for (const name of ["旅", "荷造り", "出発前のメモ", "予約", "出発"]) {
      const handle = grip(name);
      await expect(handle).toBeVisible();
      await expect(handle).toBeEnabled();
      const content = name === "荷造り" ? checkbox : editor(page).getByText(name, { exact: true });
      const [handleBox, contentStart] = await Promise.all([
        handle.boundingBox(),
        content.evaluate((element) => {
          const block = element.closest("[data-content-type]")!;
          // Bullet and number markers are ::before flex items immediately before the text.
          const marker = getComputedStyle(block, "::before");
          const markerWidth = marker.content === "none" ? 0 : parseFloat(marker.width) || 0;
          return element.getBoundingClientRect().left - markerWidth;
        }),
      ]);
      expect(handleBox!.x + handleBox!.width).toBeLessThanOrEqual(contentStart + 1);
      if (isMobile) {
        expect(handleBox!.width).toBeGreaterThanOrEqual(44);
        expect(handleBox!.height).toBeGreaterThanOrEqual(38);
      }
    }
    const [memoBox, nextBox] = await Promise.all([
      grip("出発前のメモ").boundingBox(),
      grip("予約").boundingBox(),
    ]);
    const rowStep = nextBox!.y - memoBox!.y;
    expect(rowStep).toBeGreaterThanOrEqual(memoBox!.height - 1);
    expect(rowStep).toBeLessThan(44);
    if (isMobile) {
      const toolbar = page.locator(".shared-page-toolbar");
      expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await expectUnobscured(toolbar.getByRole("button", { name: "編集を終了", exact: true }));
    }
    const activate = (button: Locator) => (isMobile ? button.tap() : button.click());
    // Center the row midway through the drag to keep both endpoints clear of the fixed navigation.
    await grip("靴下").evaluate((element) => {
      element.scrollIntoView({ block: "center", behavior: "instant" });
    });
    await expectUnobscured(grip("旅"));
    await expectUnobscured(grip("予約"));
    const from = (await grip("旅").boundingBox())!;
    const to = (await grip("予約").boundingBox())!;
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const dropPreview = page.locator('[data-drop-edge="after"]').filter({ has: grip("予約") });
    const parentMoveSaved = operationResponse(page, "patchSharedPage");
    if (isMobile) {
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...start, id: 1 }],
        });
        for (let step = 1; step <= 10; step++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: start.x, y: start.y + ((end.y - start.y) * step) / 10, id: 1 }],
          });
        }
        await expect(grip("旅")).toHaveAttribute("aria-pressed", "true");
        await expect(dropPreview).toBeVisible();
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } finally {
        await cdp.detach();
      }
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, start.y + 12, { steps: 5 });
      await expect(grip("旅")).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(end.x, end.y, { steps: 15 });
      await expect(dropPreview).toBeVisible();
      await page.mouse.up();
    }
    await expect(rows).toHaveText(["出発前のメモ", "予約", ...subtree, "出発"]);
    await expect(checkbox).toBeChecked();
    await saved(parentMoveSaved);
    await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("shared-page-reorder.png") });
    await activate(grip("荷造り"));
    const moveChecklist = page.getByRole("button", { name: "荷造り を下へ移動", exact: true });
    await expect(moveChecklist).toBeVisible();
    await activate(moveChecklist);
    await activate(grip("雨具"));
    await activate(page.getByRole("button", { name: "雨具 を上へ移動", exact: true }));
    await activate(grip("出発前のメモ"));
    await activate(page.getByRole("button", { name: "出発前のメモ を下へ移動", exact: true }));
    const expected = [
      "予約",
      "出発前のメモ",
      "旅",
      "交通",
      "荷造り",
      "雨具",
      "着替え",
      "靴下",
      "出発",
    ];
    await expect(rows).toHaveText(expected);
    await activate(checkbox);
    await expect(checkbox).not.toBeChecked();
    await finishEditing(page);
    await page.reload();
    await expect(rows).toHaveText(expected);
    await expect(heading).toHaveAttribute("data-id", headingId!);
    await expect(heading.getByRole("checkbox")).not.toBeChecked();
    const children = checklist.locator(":scope > .bn-block-group");
    await expect(children.locator(".bn-inline-content")).toHaveText(["雨具", "着替え", "靴下"]);
    await expect(children.locator(".bn-block-group").locator(".bn-inline-content")).toHaveText([
      "靴下",
    ]);
    await expect(handles).toHaveCount(0);
  },
);

test(
  "native text selection copies only the highlighted part of a shared page in read and edit modes",
  { tag: ["@shared-pages"] },
  async ({ page, context }) => {
    await authenticate(context);
    await context.grantPermissions(["clipboard-read"], { origin });
    const body = "週末は京都駅で集合します。";
    await page.goto("/pages/new");
    await page.getByRole("textbox", { name: "タイトル", exact: true }).fill("集まる場所");
    await editor(page).press("ControlOrMeta+b");
    await page.keyboard.insertText(body);
    await expect(editor(page).locator("strong")).toHaveText(body);
    await expect(
      page.getByRole("button", { name: `${body} をドラッグして並び替え` }),
    ).toBeVisible();
    const created = operationResponse(page, "postSharedPage");
    await page.getByRole("button", { name: "作成する", exact: true }).click();
    await saved(created);
    await expect(page.getByRole("button", { name: "編集する", exact: true })).toBeVisible();
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.postData()?.includes('"patchSharedPage"')) writes.push(request.url());
    });
    for (const [index, selected] of ["京都駅", "集合"].entries()) {
      if (index === 1) await beginEditing(page);
      const paragraph = editor(page).locator("strong").filter({ hasText: body });
      await paragraph.scrollIntoViewIfNeeded();
      // The range only locates the glyphs. The actual selection comes from a pointer drag.
      const bounds = await paragraph.evaluate((element, value) => {
        const text = element.firstChild!;
        const offset = text.textContent!.indexOf(value);
        const range = document.createRange();
        range.setStart(text, offset);
        range.setEnd(text, offset + value.length);
        const { left, right, top, height } = range.getBoundingClientRect();
        return { left, right, y: top + height / 2 };
      }, selected);
      await page.mouse.move(bounds.left + 1, bounds.y);
      await page.mouse.down();
      await page.mouse.move(bounds.right - 1, bounds.y, { steps: 12 });
      await page.mouse.up();
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toBe(selected);
      await page.keyboard.press("ControlOrMeta+c");
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
      if (index === 1) {
        const bold = await page.evaluate(async () => {
          const [item] = await navigator.clipboard.read();
          const html = await (await item.getType("text/html")).text();
          return new DOMParser().parseFromString(html, "text/html").querySelector("strong,b")
            ?.textContent;
        });
        expect(bold).toBe(selected);
      }
    }
    await finishEditing(page);
    expect(writes).toEqual([]);
  },
);

test(
  "shared page editing allows the same member's sessions while other members and teams stay isolated",
  { tag: ["@shared-pages", "@realtime"] },
  async ({ page, context, browser }, testInfo) => {
    const peerContext = await browser.newContext({ baseURL: origin });
    const deviceContext = await browser.newContext({ baseURL: origin });
    const outsiderContext = await browser.newContext({ baseURL: origin });
    try {
      await authenticate(context);
      await authenticate(peerContext, peer.token);
      await authenticate(deviceContext, secondSessionToken);
      await authenticate(outsiderContext, outsider.token);
      const title = `暮らしの共有 ${crypto.randomUUID().slice(0, 8)}`;
      const body = "ふたりで読むためのメモ。";
      const pagePath = await createPage(page, title, body);
      const peerPage = await peerContext.newPage();
      const sameUserTab = await context.newPage();
      const sameUserDevice = await deviceContext.newPage();
      const outside = await outsiderContext.newPage();
      await Promise.all([
        peerPage.goto(pagePath),
        sameUserTab.goto(pagePath),
        sameUserDevice.goto(pagePath),
        outside.goto("/pages"),
      ]);
      for (const reader of [peerPage, sameUserTab, sameUserDevice]) {
        await expect(reader.locator(".bn-editor")).toContainText(body);
        await expect(reader.getByRole("button", { name: "編集する", exact: true })).toBeEnabled();
      }
      await expect(outside.getByText(title, { exact: true })).toHaveCount(0);
      await outside.goto(pagePath);
      await expect(outside.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
      await expect(outside.getByText(body, { exact: true })).toHaveCount(0);
      await expect(outside.getByRole("alert")).toBeVisible();

      // Merely opening three readers must not prevent the original tab from acquiring.
      await beginEditing(page);
      await expect(peerPage.getByText(/編集中です/)).toBeVisible();
      await expect(peerPage.locator('.bn-editor[contenteditable="true"]')).toHaveCount(0);
      await expect(peerPage.getByRole("button", { name: /をドラッグして並び替え$/ })).toHaveCount(
        0,
      );
      await expect(peerPage.locator(".bn-editor")).toContainText(body);
      for (const sameMemberPage of [sameUserTab, sameUserDevice]) {
        await expect(
          sameMemberPage.getByRole("button", { name: "編集する", exact: true }),
        ).toBeEnabled();
        await beginEditing(sameMemberPage);
      }

      // The lease belongs to a member, so both another tab and another login session
      // can edit. One of them can release it for all of that member's open editors.
      await finishEditing(sameUserDevice);
      for (const previousEditor of [sameUserTab, page]) {
        const released = operationResponse(previousEditor, "releaseSharedPageLease");
        await previousEditor.getByRole("button", { name: "編集を終了", exact: true }).click();
        // These releases may report a lost lease. Wait for each response before
        // acquiring again: a delayed same-member release could end the next edit.
        await (await released).finished();
        await expect(
          previousEditor.getByRole("button", { name: "編集する", exact: true }),
        ).toBeEnabled();
      }
      await Promise.all([sameUserTab.close(), sameUserDevice.close()]);
      await page.reload();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await beginEditing(page);
      await expect(peerPage.getByText(/編集中です/)).toBeVisible();
      await peerPage.screenshot({
        path: testInfo.outputPath("shared-page-peer-editing.png"),
        fullPage: true,
      });
      const updated = operationResponse(page, "patchSharedPage");
      const newBody = "保存された更新を相手の画面にも届ける。";
      await editor(page).fill(newBody);
      const originalSave = await saved(updated);
      await expect(peerPage.locator(".bn-editor")).toContainText(newBody);
      const originalRelease = await finishEditing(page);
      await expect(peerPage.getByRole("button", { name: "編集する", exact: true })).toBeEnabled();
      await beginEditing(peerPage);
      // Replay the previous member's requests after a different member acquires.
      // Their release and save must neither unlock the new owner nor overwrite content.
      const staleRelease = await context.request.fetch(originalRelease.request());
      expect(await staleRelease.text()).toContain("edit_lease_lost");
      const staleSave = await context.request.fetch(originalSave.request());
      expect(await staleSave.text()).toContain("edit_lease_lost");
      const peerSaved = operationResponse(peerPage, "patchSharedPage");
      await editor(peerPage).fill("相手に引き継いで保存したメモ。");
      await saved(peerSaved);
      await finishEditing(peerPage);
      await expect(page.locator(".bn-editor")).toContainText("相手に引き継いで保存したメモ。");
    } finally {
      await Promise.all([peerContext.close(), deviceContext.close(), outsiderContext.close()]);
    }
  },
);

for (const failurePoint of ["before commit", "after commit"]) {
  test(
    `shared page creation retry opens exactly one page after failure ${failurePoint}`,
    { tag: ["@shared-pages"] },
    async ({ page, context }) => {
      await authenticate(context);
      const title = `作成の再試行 ${crypto.randomUUID().slice(0, 8)}`;
      const body = "一度だけ作成されるふたりのメモ。";
      await page.goto("/pages/new");
      await page.getByRole("textbox", { name: "タイトル", exact: true }).fill(title);
      await editor(page).fill(body);
      const status = page.locator(".shared-page-toolbar").getByRole("status");
      await expect(status).toHaveText("未作成");
      let createRequests = 0;
      let fail!: () => void;
      const firstAttempt = new Promise<void>((resolve) => {
        fail = resolve;
      });
      await page.route("**/_serverFn/**", async (route) => {
        if (route.request().postData()?.includes('"postSharedPage"')) {
          createRequests++;
          if (createRequests === 1) {
            // Commit in D1, then lose the response on its way back to the editor.
            if (failurePoint === "after commit") {
              const committed = await route.fetch();
              expect(committed.ok()).toBe(true);
              await committed.dispose();
            }
            await firstAttempt;
            return route.abort("failed");
          }
        }
        return route.continue();
      });

      try {
        await page.getByRole("button", { name: "作成する", exact: true }).click();
        await expect(status).toHaveText("作成中…");
      } finally {
        fail();
      }
      await expect(status).toHaveText("保存失敗");
      await expect(page).toHaveURL(/\/pages\/new$/);
      await expect(editor(page)).toContainText(body);
      expect(createRequests).toBe(1);

      const retried = operationResponse(page, "postSharedPage");
      await page.getByRole("button", { name: "再試行", exact: true }).click();
      await saved(retried);
      await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "編集する", exact: true })).toBeVisible();
      await expect(editor(page)).toHaveAttribute("contenteditable", "false");
      await expect(editor(page)).toContainText(body);
      await expect(page.getByRole("button", { name: "作成する", exact: true })).toHaveCount(0);

      await page.getByRole("button", { name: "共有ページへ戻る", exact: true }).click();
      await expect(page).toHaveURL(/\/pages\/?$/);
      const listed = operationResponse(page, "listSharedPages");
      await page.reload();
      await saved(listed);
      await expect(
        page.getByRole("link").filter({ has: page.getByText(title, { exact: true }) }),
      ).toHaveCount(1);
      expect(createRequests).toBe(2);
    },
  );
}

test(
  "shared page offline failure retains input and reconnect never automatically resends a save",
  { tag: ["@shared-pages", "@realtime"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context);
    const title = `通信の確認 ${crypto.randomUUID().slice(0, 8)}`;
    await createPage(page, title, "保存済みの内容。");
    await beginEditing(page);
    let saves = 0;
    page.on("request", (request) => {
      if (request.postData()?.includes('"patchSharedPage"')) saves++;
    });
    await context.setOffline(true);
    const draft = "通信が切れても失いたくない入力。";
    let attempts = 0;
    try {
      await editor(page).fill(draft);
      await expect(page.getByText("保存失敗", { exact: true })).toBeVisible();
      await expect(editor(page)).toContainText(draft);
      await expect(page.getByRole("button", { name: "入力をコピー", exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("shared-page-save-failed.png"),
        fullPage: true,
      });
      attempts = saves;
    } finally {
      const reconnectedRead = operationResponse(page, "getSharedPage");
      await context.setOffline(false);
      // A real refetch after reconnect must not replace the editor's unsaved draft.
      await saved(reconnectedRead);
    }
    await expect(page.getByText("保存失敗", { exact: true })).toBeVisible();
    await expect(editor(page)).toContainText(draft);
    expect(saves).toBe(attempts);
    const retried = operationResponse(page, "patchSharedPage");
    await page.getByRole("button", { name: "再試行", exact: true }).click();
    await saved(retried);
    await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
    await finishEditing(page);
    await page.reload();
    await expect(page.locator(".bn-editor")).toContainText(draft);
  },
);

test(
  "shared page unsaved navigation keeps the draft until explicit discard",
  { tag: ["@shared-pages"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context);
    const title = `未保存の確認 ${crypto.randomUUID().slice(0, 8)}`;
    const pagePath = await createPage(page, title, "保存済みの文章。");
    await beginEditing(page);
    await page.route("**/_serverFn/**", (route) => {
      if (route.request().postData()?.includes('"patchSharedPage"')) return route.abort("failed");
      return route.continue();
    });
    const draft = "破棄するまでは残しておく文章。";
    await editor(page).fill(draft);
    await expect(page.getByText("保存失敗", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "共有ページへ戻る", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toContainText("保存していない変更");
    await page.screenshot({ path: testInfo.outputPath("shared-page-unsaved.png"), fullPage: true });
    // Exercise both clipboard acknowledgement and the shared fallback sheet without OS clipboard access.
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => {
          (window as unknown as { copiedDraft: string }).copiedDraft = text;
        },
      });
    });
    await confirmation.getByRole("button", { name: "入力をコピー", exact: true }).click();
    await expect(
      confirmation.getByRole("button", { name: "入力をコピー済み", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { copiedDraft: string }).copiedDraft),
    ).toContain(draft);
    await expect(
      confirmation.getByRole("button", { name: "入力をコピー", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async () => {
          throw new Error("clipboard unavailable");
        },
      });
    });
    await confirmation.getByRole("button", { name: "入力をコピー", exact: true }).click();
    const copySheet = page.getByRole("dialog", { name: "入力内容をコピー", exact: true });
    await expect(copySheet).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const copyInput = copySheet.getByRole("textbox", { name: "コピーする入力内容", exact: true });
    await expect(copyInput).toHaveValue(`${title}\n\n${draft}`);
    await copySheet.getByRole("button", { name: "入力を選択", exact: true }).click();
    expect(
      await copyInput.evaluate(
        (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
      ),
    ).toBe(`${title}\n\n${draft}`.length);
    await page.screenshot({ path: testInfo.outputPath("shared-page-copy-fallback.png") });
    await copySheet.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(confirmation).toContainText("保存していない変更");
    await confirmation.getByRole("button", { name: "編集を続ける", exact: true }).click();
    await expect(editor(page)).toContainText(draft);
    await page.getByRole("button", { name: "共有ページへ戻る", exact: true }).click();
    await confirmation.getByRole("button", { name: "変更を破棄して戻る", exact: true }).click();
    await expect(page).toHaveURL(/\/pages\/?$/);
    await page.unrouteAll({ behavior: "wait" });
    await page.goto(pagePath);
    await expect(page.locator(".bn-editor")).toContainText("保存済みの文章。");
    await expect(page.getByText(draft, { exact: true })).toHaveCount(0);
  },
);

test(
  "shared page reload restores unsaved input read-only without replaying its old edit session",
  { tag: ["@shared-pages"] },
  async ({ page, context }, testInfo) => {
    await authenticate(context);
    const title = `復旧の確認 ${crypto.randomUUID().slice(0, 8)}`;
    const savedBody = "サーバーに保存された本文。";
    const pagePath = await createPage(page, title, savedBody);
    await beginEditing(page);
    await page.route("**/_serverFn/**", (route) => {
      if (route.request().postData()?.includes('"patchSharedPage"')) return route.abort("failed");
      return route.continue();
    });
    const draftTitle = `${title}・未保存`;
    const draftBody = "再読み込みしても、確認するまでは手元に残す文章。";
    await page.getByRole("textbox", { name: "タイトル", exact: true }).fill(draftTitle);
    await editor(page).fill(draftBody);
    await expect(page.getByText("保存失敗", { exact: true })).toBeVisible();
    const backup = await page.evaluate(
      ({ userId, pageId }) => {
        const key = Object.keys(sessionStorage).find(
          (candidate) =>
            candidate.startsWith(`kaji:shared-page-draft:v1:${userId}:`) &&
            candidate.endsWith(`:${pageId}`),
        );
        return key ? JSON.parse(sessionStorage.getItem(key)!) : null;
      },
      { userId: owner.id, pageId: pagePath.split("/").at(-1)! },
    );
    expect(backup).toMatchObject({ title: draftTitle, document: { format: "blocknote" } });
    // Persist recoverable content only, never a bearer lease or a queued mutation.
    expect(Object.keys(backup).sort()).toEqual(["document", "text", "title"]);
    await page.unrouteAll({ behavior: "wait" });

    let automaticWrites = 0;
    page.on("request", (request) => {
      const data = request.postData();
      if (
        data &&
        ["postSharedPage", "patchSharedPage", "postSharedPageLease"].some((operation) =>
          data.includes(`"${operation}"`),
        )
      )
        automaticWrites++;
    });
    let acceptedReload = false;
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("beforeunload");
      acceptedReload = true;
      await dialog.accept();
    });
    await page.reload();
    expect(acceptedReload).toBe(true);
    await expect(page.getByRole("alert")).toContainText("このタブに未保存の入力が残っています。");
    await expect(page.getByRole("alert")).toContainText("自動では保存しません。");
    await expect(page.getByRole("textbox", { name: "タイトル", exact: true })).toHaveValue(
      draftTitle,
    );
    await expect(page.getByRole("textbox", { name: "タイトル", exact: true })).not.toBeEditable();
    await expect(page.locator(".bn-editor")).toContainText(draftBody);
    await expect(page.locator('.bn-editor[contenteditable="true"]')).toHaveCount(0);
    await expect(page.getByText("編集を停止", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "入力をコピー", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "再試行", exact: true })).toHaveCount(0);
    expect(automaticWrites).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath("shared-page-recovered-draft.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "最新を確認", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toContainText("保存していない変更");
    await confirmation
      .getByRole("button", { name: "変更を破棄して最新を表示", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.locator(".bn-editor")).toContainText(savedBody);
    await expect(page.locator(".bn-editor")).not.toContainText(draftBody);
    expect(automaticWrites).toBe(0);
  },
);
