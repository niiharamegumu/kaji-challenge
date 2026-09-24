import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bindings: { MAINTENANCE_MODE: "true", DB: {} },
  connect: vi.fn(),
  auth: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.bindings }));
vi.mock("../../src/server/infrastructure/database", () => ({ createDatabase: mocks.connect }));
vi.mock("../../src/server/transport/auth-settings", () => ({ authSettings: mocks.settings }));
vi.mock("../../src/server/infrastructure/auth", () => ({ createAuth: mocks.auth }));
import { withRuntime } from "../../src/server/transport/runtime.server";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.bindings.MAINTENANCE_MODE = "false";
  mocks.connect.mockReturnValue({ db: {}, repository: {} });
  mocks.auth.mockReturnValue({});
  mocks.settings.mockReturnValue({});
});
it("blocks even read operations before accessing D1 during maintenance", async () => {
  mocks.bindings.MAINTENANCE_MODE = "true";
  const operation = vi.fn();
  await expect(withRuntime(operation)).rejects.toMatchObject({ status: 503, code: "maintenance" });
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
});

it("returns the operation result", async () => {
  await expect(withRuntime(async () => "result")).resolves.toBe("result");
});

it("propagates operation failures", async () => {
  const failure = new Error("operation failed");
  await expect(
    withRuntime(async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});

it("stops before the operation if auth initialization fails", async () => {
  const failure = new Error("auth failed");
  mocks.auth.mockImplementation(() => {
    throw failure;
  });
  const operation = vi.fn();
  await expect(withRuntime(operation)).rejects.toBe(failure);
  expect(operation).not.toHaveBeenCalled();
});

it("validates configuration before constructing the D1 repository", async () => {
  mocks.settings.mockImplementation(() => {
    throw new Error("invalid settings");
  });
  await expect(withRuntime(vi.fn())).rejects.toThrow("invalid settings");
  expect(mocks.connect).not.toHaveBeenCalled();
});
