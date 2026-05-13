import { vi } from "vitest";

export const withExpectedConsoleError = async <T>(
  run: () => Promise<T>,
): Promise<T> => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
};
