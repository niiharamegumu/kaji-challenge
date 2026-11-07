import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

// jsdom has no scroll implementation; router scroll behavior is covered in Playwright.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true });
}

// jsdom does not implement native dialog modality; Playwright covers the browser behavior.
for (const method of ["showModal", "close"] as const) {
  if (!HTMLDialogElement.prototype[method]) {
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
  }
}
