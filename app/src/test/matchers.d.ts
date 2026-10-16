import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import "vitest";

declare module "vitest" {
  // jest-dom 7's Vitest entrypoint still augments the pre-v5 Assertion<T> type.
  // Preserve Vitest 5's void/Promise<void> return type through its Matchers API.
  interface Matchers<R, T> extends TestingLibraryMatchers<any, R> {}
}
