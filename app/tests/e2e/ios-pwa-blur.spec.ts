import { expect, test } from "@playwright/test";

for (const standalone of [true, false, undefined]) {
  test(`iOS blur workaround is active only for standalone=${standalone}`, async ({ page }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, "standalone", { configurable: true, value });
    }, standalone);
    await page.goto("/");

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
        background: style.backgroundColor,
        opacity: style.opacity,
      };
    });
    expect(geometry.top).toBe(0);
    expect(geometry.left).toBe(0);
    expect(geometry.width).toBe(geometry.viewportWidth);
    expect(geometry.height).toBeCloseTo(10.1, 1);
    expect(geometry.background).toBe("rgba(255, 255, 255, 0.004)");
    expect(geometry.opacity).toBe("0.1");

    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<button style="position:fixed;top:0;left:0;z-index:9999;width:50px;height:10px">上端の操作</button>',
      );
      const button = document.body.lastElementChild!;
      button.addEventListener("click", () => button.setAttribute("data-clicked", "true"));
    });
    const button = page.getByRole("button", { name: "上端の操作" });
    await button.click();
    await expect(button).toHaveAttribute("data-clicked", "true");
  });
}
