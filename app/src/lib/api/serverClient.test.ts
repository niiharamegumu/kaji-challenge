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

  it("serializes writes with the latest revision while allowing reads in parallel", async () => {
    setLatestTeamEtag(etag);
    let finishWrite!: (value: unknown) => void;
    let finishRead!: (value: unknown) => void;
    invoke.mockImplementation(({ data }) => {
      if (data.operation === "listShoppingItems")
        return new Promise((resolve) => {
          finishRead = resolve;
        });
      if (data.body.nickname === "first")
        return new Promise((resolve) => {
          finishWrite = resolve;
        });
      return {
        ok: true,
        state: { ...state, revision: "9007199254740995" },
        data: { nickname: "second", effectiveName: "second" },
      };
    });
    const first = patchMeNickname({ nickname: "first" });
    const second = patchMeNickname({ nickname: "second" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const read = listShoppingItems();
    expect(invoke).toHaveBeenCalledTimes(2);
    finishWrite({
      ok: true,
      state: { ...state, revision: "9007199254740994" },
      data: { nickname: "first", effectiveName: "first" },
    });
    await Promise.all([first, second]);
    expect(invoke.mock.calls[2][0].data.expectedState.revision).toBe("9007199254740994");
    finishRead({ ok: true, state, data: { items: [] } });
    await read;
    expect(getLatestTeamEtag()).toContain("9007199254740995");
  });

  it("continues after a failed write without automatically retrying it", async () => {
    setLatestTeamEtag(etag);
    invoke
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, state, data: {} });
    const failed = deleteTask("first");
    const next = deleteTask("second");
    await expect(failed).rejects.toThrow("offline");
    await expect(next).resolves.toMatchObject({ status: 204 });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not make the new session wait for the old session's unfinished write", async () => {
    setLatestTeamEtag(etag);
    let finishOld!: (value: unknown) => void;
    invoke
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        state: { ...state, revision: "9007199254740994" },
        data: {},
      });
    const oldRequest = deleteTask("old-session");
    const oldQueued = deleteTask("old-queued");
    const oldResults = Promise.allSettled([oldRequest, oldQueued]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    setLatestTeamEtag("");
    setLatestTeamEtag(etag);
    await expect(deleteTask("new-session")).resolves.toMatchObject({ status: 204 });
    finishOld({ ok: true, state, data: {} });
    for (const result of await oldResults)
      expect(result).toMatchObject({ status: "rejected", reason: { name: "AbortError" } });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(getLatestTeamEtag()).toContain("9007199254740994");
  });

  it.each(["logout", "team change", "abort"])(
    "discards queued operations after %s",
    async (reason) => {
      setLatestTeamEtag(etag);
      let finish!: (value: unknown) => void;
      invoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const first = deleteTask("first");
      const controller = new AbortController();
      const second = deleteTask("second", { signal: controller.signal });
      const settled = Promise.allSettled([first, second]);
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      if (reason === "logout") setLatestTeamEtag("");
      if (reason === "team change") setLatestTeamEtag('W/"team:another:rev:1"');
      if (reason === "abort") controller.abort();
      finish({ ok: true, state, data: {} });
      const results = await settled;
      expect(results[1]).toMatchObject({ status: "rejected", reason: { name: "AbortError" } });
      expect(invoke).toHaveBeenCalledTimes(1);
      if (reason !== "abort") {
        expect(results[0]).toMatchObject({ status: "rejected", reason: { name: "AbortError" } });
        expect(getLatestTeamEtag()).toBe(reason === "logout" ? "" : 'W/"team:another:rev:1"');
      }
    },
  );

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
