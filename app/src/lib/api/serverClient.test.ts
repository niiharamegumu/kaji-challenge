import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelTeamRequests } from "./serverClient";
import { deleteTask, listShoppingItems, patchMeNickname } from "./operations";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("../../server/transport/operations.functions", () => ({ invokeOperation: invoke }));

describe("Server Function adapters", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  it("sends writes immediately without revision or a client write queue", async () => {
    let resolve!: (value: unknown) => void;
    invoke
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue({ ok: true, data: { nickname: "second", effectiveName: "second" } });
    const first = patchMeNickname({ nickname: "first" });
    const second = patchMeNickname({ nickname: "second" });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0].data).toEqual({
      operation: "patchMeNickname",
      params: {},
      body: { nickname: "first" },
    });
    expect((await second).headers.has("ETag")).toBe(false);
    resolve({ ok: true, data: { nickname: "first", effectiveName: "first" } });
    await first;
  });
  it("maps errors without retrying writes", async () => {
    invoke.mockResolvedValue({
      ok: false,
      error: { status: 403, code: "forbidden", message: "Forbidden" },
    });
    await expect(deleteTask("task")).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 403,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["invalid", { items: [{ id: false }] }])("rejects malformed DTOs: %s", async (data) => {
    invoke.mockResolvedValue({ ok: true, data });
    await expect(listShoppingItems()).rejects.toThrow();
  });
  it("honors cancellation before sending and after a late response", async () => {
    const controller = new AbortController();
    let resolve!: (v: unknown) => void;
    invoke.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const request = listShoppingItems({ signal: controller.signal });
    controller.abort();
    resolve({ ok: true, data: { items: [] } });
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await expect(listShoppingItems({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("preserves delete responses", async () => {
    invoke.mockResolvedValue({ ok: true, data: {} });
    await expect(deleteTask("task")).resolves.toMatchObject({ status: 204, data: {} });
  });
});

it("discards old team responses and allows new requests without waiting", async () => {
  let resolve!: (result: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const previous = patchMeNickname({ nickname: "Old" });
  cancelTeamRequests();
  invoke.mockResolvedValueOnce({ ok: true, data: { nickname: "New", effectiveName: "New" } });
  await expect(patchMeNickname({ nickname: "New" })).resolves.toMatchObject({
    data: { nickname: "New" },
  });
  resolve({ ok: true, data: { nickname: "Old", effectiveName: "Old" } });
  await expect(previous).rejects.toMatchObject({ name: "AbortError" });
});
