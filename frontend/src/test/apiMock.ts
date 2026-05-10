import type { vi } from "vitest";

export type ApiMockMap = Record<string, ReturnType<typeof vi.fn>>;

export const resetApiMocks = (mocks: ApiMockMap) => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
};

export const resolvedData = <T>(data: T) => ({ data });
