import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestTeamEtag, setLatestTeamEtag } from "./api-client-state";
import { deleteTask, listShoppingItems, patchMeNickname } from "./operations";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../../server/transport/operations.functions", () => ({ invokeOperation: invoke }));

const state = { teamId: "00000000-0000-4000-8000-000000000001", revision: "9007199254740993" };
const etag = `W/"team:${state.teamId}:rev:${state.revision}"`;

describe("Server Function adapters", () => {
  beforeEach(() => {
    invoke.mockReset();
    setLatestTeamEtag("");
  });

  it("requires a known team revision before sending a business mutation", async () => {
    await expect(patchMeNickname({ nickname: "名前" })).rejects.toMatchObject({
      status: 428,
      code: "precondition_required",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("preserves bigint revision precision and forwards cancellation", async () => {
    setLatestTeamEtag(etag);
    const next = { ...state, revision: "9007199254740994" };
    const data = { nickname: "名前", effectiveName: "名前" };
    invoke.mockResolvedValue({ ok: true, state: next, data });
    const signal = new AbortController().signal;
    const result = await patchMeNickname({ nickname: "名前" }, { signal });
    expect(invoke).toHaveBeenCalledWith({
      data: {
        operation: "patchMeNickname",
        params: {},
        body: { nickname: "名前" },
        expectedState: state,
      },
      signal,
    });
    expect(result.data).toEqual(data);
    expect(result.status).toBe(200);
    expect(result.headers.get("ETag")).toBe(getLatestTeamEtag());
    expect(getLatestTeamEtag()).toContain(next.revision);
  });

  it("maps conflicts to the existing refetch flow and updates the expected state", async () => {
    setLatestTeamEtag('W/"team:stale:rev:1"');
    invoke.mockResolvedValue({
      ok: false,
      error: {
        status: 412,
        code: "precondition_failed",
        message: "最新状態を取得してください。",
        currentState: state,
      },
    });
    await expect(deleteTask("task-id")).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 412,
      currentEtag: etag,
    });
    expect(getLatestTeamEtag()).toBe(etag);
  });

  it.each(["invalid response", { items: [{ id: false }] }])(
    "does not advance state on invalid response: %s",
    async (data) => {
      setLatestTeamEtag(etag);
      invoke.mockResolvedValue({
        ok: true,
        state: { ...state, revision: "9007199254740994" },
        data,
      });
      await expect(listShoppingItems()).rejects.toThrow();
      expect(getLatestTeamEtag()).toBe(etag);
    },
  );

  it("preserves the empty response and status for deletes", async () => {
    setLatestTeamEtag(etag);
    invoke.mockResolvedValue({ ok: true, state, data: {} });
    await expect(deleteTask("task-id")).resolves.toMatchObject({ status: 204, data: {} });
  });

  it("does not send an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(listShoppingItems({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { ok: true, state, data: { items: [] } },
    {
      ok: false,
      error: { status: 412, code: "precondition_failed", message: "conflict", currentState: state },
    },
  ])("ignores a late response after cancellation: $ok", async (response) => {
    let resolve!: (value: typeof response) => void;
    invoke.mockReturnValue(
      new Promise<typeof response>((done) => {
        resolve = done;
      }),
    );
    const controller = new AbortController();
    const request = listShoppingItems({ signal: controller.signal });
    controller.abort();
    resolve(response);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(getLatestTeamEtag()).toBe("");
  });
});
