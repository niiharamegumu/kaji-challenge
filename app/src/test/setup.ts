import "@testing-library/jest-dom/vitest";

// jsdom has no scroll implementation; router scroll behavior is covered in Playwright.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true });
}
