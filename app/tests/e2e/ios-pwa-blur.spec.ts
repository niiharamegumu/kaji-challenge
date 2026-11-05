import { expect, test } from "@playwright/test";

for (const standalone of [true, false, undefined]) {
  test(`iOS blur workaround is active only for standalone=${standalone}`, async ({ page }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, "standalone", { configurable: true, value });
    }, standalone);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();

    const layer = page.locator(".ios-pwa-blur-workaround");
    await expect(layer).toHaveAttribute("aria-hidden", "true");
    if (standalone !== true) {
      await expect(layer).toBeHidden();
      return;
    }

    await expect(layer).toBeVisible();
    await expect(layer).toHaveCSS("position", "fixed");
    await expect(layer).toHaveCSS("pointer-events", "none");
    await expect(layer).toHaveCSS("z-index", "10000");
    const geometry = await layer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        viewportWidth: document.documentElement.clientWidth,
        height: rect.height,
        backgroundColor: style.backgroundColor,
        canvasColor: getComputedStyle(document.body).backgroundColor,
        backgroundClip: style.backgroundClip,
        opacity: style.opacity,
      };
    });
    expect(geometry.top).toBe(0);
    expect(geometry.left).toBe(0);
    expect(geometry.width).toBe(geometry.viewportWidth);
    expect(geometry.height).toBe(11);
    expect(geometry.backgroundColor).toBe(geometry.canvasColor);
    expect(geometry.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(geometry.backgroundClip).toBe("text");
    expect(geometry.opacity).toBe("1");

    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<button style="position:fixed;top:0;left:0;z-index:9999;width:50px;height:11px;background:#123456;border:0">上端の操作</button>',
      );
      const button = document.body.lastElementChild!;
      button.addEventListener("click", () => button.setAttribute("data-clicked", "true"));
    });
    const button = page.getByRole("button", { name: "上端の操作" });
    await button.click();
    await expect(button).toHaveAttribute("data-clicked", "true");
    const clip = { x: 0, y: 0, width: 40, height: 8 };
    const withLayer = await page.screenshot({ clip, animations: "disabled" });
    await layer.evaluate((element) => {
      (element as HTMLElement).style.display = "none";
    });
    expect(await page.screenshot({ clip, animations: "disabled" })).toEqual(withLayer);
  });
}
