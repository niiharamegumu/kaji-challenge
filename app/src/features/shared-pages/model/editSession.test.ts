import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "../../../lib/api/serverClient";
import type {
  SharedPage,
  SharedPageDocument,
  SharedPageLease,
  SharedPageLeaseResponse,
} from "../../../contracts/shared-pages";
import type { sharedPagesApi } from "../api/sharedPagesApi";
import {
  draftText,
  editTiming,
  isEditingByAnotherUser,
  PageEditSession,
  type PageDraft,
} from "./editSession";
import { clearDraftBackup, draftBackupKey, readDraftBackup, writeDraftBackup } from "./draftBackup";

vi.mock("../api/sharedPagesApi", () => ({ sharedPagesApi: {} }));

const PAGE_ID = "c6b4ea38-5208-4a5d-8aac-3e233b2e5a18";
const START = Date.parse("2026-11-06T12:00:00.000Z");
const document: SharedPageDocument = {
  format: "blocknote",
  schemaVersion: 1,
  blocks: [
    {
      id: "one",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "暮らしのメモ", styles: {} }],
      children: [],
    },
  ],
};
const page = (title = "保存済み", version = 7): SharedPage => ({
  id: PAGE_ID,
  title,
  document,
  version,
  createdAt: new Date(START).toISOString(),
  updatedAt: new Date(START).toISOString(),
  updatedByName: "あおい",
  editing: null,
});
const lease = (): SharedPageLease => ({
  serverNow: new Date(Date.now()).toISOString(),
  expiresAt: new Date(Date.now() + 90_000).toISOString(),
});
const response = <T>(data: T): ApiResult<T> => ({ data, status: 200, headers: new Headers() });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function api() {
  return {
    create: vi
      .fn<typeof sharedPagesApi.create>()
      .mockImplementation(async (body) =>
        response({ ...page(body.title, 0), document: body.document }),
      ),
    save: vi
      .fn<typeof sharedPagesApi.save>()
      .mockImplementation(async (_id, body) =>
        response({ ...page(body.title, body.expectedVersion + 1), document: body.document }),
      ),
    acquire: vi
      .fn<typeof sharedPagesApi.acquire>()
      .mockImplementation(async () => response({ page: page(), lease: lease() })),
    renew: vi.fn<typeof sharedPagesApi.renew>().mockImplementation(async () => response(lease())),
    release: vi.fn<typeof sharedPagesApi.release>().mockResolvedValue(response({})),
    remove: vi.fn<typeof sharedPagesApi.remove>().mockResolvedValue(response({})),
  };
}
const sessions: PageEditSession[] = [];
function setup(newPage = false) {
  const mocked = api();
  const saved = vi.fn<(value: SharedPage) => void>();
  const session = new PageEditSession(newPage, saved, mocked);
  sessions.push(session);
  return { api: mocked, saved, session };
}
const change = (session: PageEditSession, title = "未保存の入力") =>
  session.change({ title, document });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.useRealTimers();
});

describe("user-owned page editor", () => {
  it("disables editing only for another user, including when the same user opens a different screen", () => {
    const owner = { userId: "owner", displayName: "あおい", expiresAt: lease().expiresAt };
    expect(isEditingByAnotherUser(owner, "owner")).toBe(false);
    expect(isEditingByAnotherUser(owner, "peer")).toBe(true);
    expect(isEditingByAnotherUser(owner, null)).toBe(true);
    expect(isEditingByAnotherUser(null, "owner")).toBe(false);
    expect(isEditingByAnotherUser(undefined, "owner")).toBe(false);
  });

  it("starts read-only without acquiring or blocking other editors", () => {
    const f = setup();
    expect(f.session.getSnapshot()).toMatchObject({ mode: "read", draft: null, busy: false });
    expect(f.api.acquire).not.toHaveBeenCalled();
    f.session.tick();
    expect(f.api.renew).not.toHaveBeenCalled();
  });

  it("restores a tab's unsaved draft in stopped mode without acquiring or replaying a write", async () => {
    const f = setup();
    const draft = { title: "復元した入力", document };
    f.session.restore(draft);
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "lost",
      draft,
      dirty: true,
      status: "stopped",
    });
    expect(f.session.getSnapshot().error).toContain("自動では保存しません");
    await f.session.save();
    await f.session.renew();
    expect(f.api.acquire).not.toHaveBeenCalled();
    expect(f.api.create).not.toHaveBeenCalled();
    expect(f.api.save).not.toHaveBeenCalled();
    expect(f.api.renew).not.toHaveBeenCalled();
    expect(draftText(f.session.getSnapshot().draft!)).toContain("復元した入力");
    f.session.discard();
    expect(f.session.getSnapshot()).toMatchObject({ mode: "read", dirty: false, draft: null });
  });

  it("starts an empty new draft only after explicit restart and does not reuse recovered input", async () => {
    const f = setup(true);
    f.session.restore({ title: "前の未保存入力", document });
    const previousEditorKey = f.session.getSnapshot().editorKey;
    f.session.restartNew();
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "new",
      dirty: false,
      busy: false,
      error: null,
      draft: { title: "", document: { format: "blocknote", schemaVersion: 1, blocks: [] } },
      editorKey: previousEditorKey + 1,
    });
    expect(f.api.create).not.toHaveBeenCalled();
    change(f.session, "新しく入力したページ");
    await f.session.save();
    expect(f.api.create).toHaveBeenCalledWith(
      { title: "新しく入力したページ", document },
      expect.any(Object),
    );
    expect(f.api.save).not.toHaveBeenCalled();
  });

  it("acquires once even on repeated clicks and edits the server's latest document", async () => {
    const f = setup();
    const pending = deferred<ApiResult<SharedPageLeaseResponse>>();
    f.api.acquire.mockReturnValueOnce(pending.promise);
    const first = f.session.begin(page("old", 1));
    await f.session.begin(page("old", 1));
    expect(f.api.acquire).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot().busy).toBe(true);
    pending.resolve(response({ page: page("最新", 8), lease: lease() }));
    await first;
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "edit",
      draft: { title: "最新" },
      dirty: false,
      status: "saved",
    });
    change(f.session);
    await f.session.save();
    expect(f.api.save).toHaveBeenCalledWith(
      PAGE_ID,
      { title: "未保存の入力", document, expectedVersion: 8 },
      expect.any(Object),
    );
  });

  it("does not attach a tab identity when separate screens acquire the same user's page", async () => {
    const first = setup();
    const second = setup();
    await first.session.begin(page());
    await second.session.begin(page());
    for (const screen of [first, second]) {
      expect(screen.api.acquire).toHaveBeenCalledWith(PAGE_ID, { signal: expect.any(AbortSignal) });
      expect(screen.session.getSnapshot().mode).toBe("edit");
    }
  });

  it("keeps a blocked acquire read-only and reports it without creating a draft", async () => {
    const f = setup();
    f.api.acquire.mockRejectedValueOnce({
      name: "ApiRequestError",
      message: "locked",
      status: 409,
      code: "page_locked",
    });
    await f.session.begin(page());
    expect(f.session.getSnapshot()).toMatchObject({ mode: "read", busy: false, draft: null });
    expect(f.session.getSnapshot().error).toContain("ほかの人が編集中");
    expect(f.api.save).not.toHaveBeenCalled();
  });

  it("serializes saves and keeps typing that arrives during a slow successful save", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session, "first draft");
    const pending = deferred<ApiResult<SharedPage>>();
    f.api.save.mockReturnValueOnce(pending.promise);
    const saving = f.session.save();
    expect(f.session.getSnapshot().status).toBe("saving");
    expect(await f.session.save()).toBeNull();
    change(f.session, "newer typing");
    pending.resolve(response(page("first draft", 8)));
    await saving;
    expect(f.api.save).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "edit",
      busy: false,
      status: "dirty",
      dirty: true,
      draft: { title: "newer typing" },
    });
    await f.session.save();
    expect(f.api.save).toHaveBeenLastCalledWith(
      PAGE_ID,
      expect.objectContaining({ title: "newer typing", expectedVersion: 8 }),
      expect.any(Object),
    );
    expect(f.session.getSnapshot()).toMatchObject({ dirty: false, status: "saved" });
  });

  it("keeps failed input and only retries on an explicit call using the same baseline version", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session);
    f.api.save.mockRejectedValueOnce(new TypeError("Offline"));
    expect(await f.session.save()).toBeNull();
    expect(f.session.getSnapshot()).toMatchObject({
      status: "error",
      dirty: true,
      draft: { title: "未保存の入力" },
    });
    change(f.session, "入力を続ける");
    expect(f.session.getSnapshot().status).toBe("error");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.api.save).toHaveBeenCalledTimes(1);
    await f.session.save();
    expect(f.api.save).toHaveBeenLastCalledWith(
      PAGE_ID,
      expect.objectContaining({ title: "入力を続ける", expectedVersion: 7 }),
      expect.any(Object),
    );
    expect(f.session.getSnapshot()).toMatchObject({ status: "saved", dirty: false });
  });

  it("keeps reverted input and its backup when a prior commit's response was lost", async () => {
    const f = setup();
    const backupKey = draftBackupKey("response-loss-user", "team", PAGE_ID);
    const unsubscribe = f.session.subscribe(() => {
      const state = f.session.getSnapshot();
      if (state.dirty && state.draft) writeDraftBackup(backupKey, state.draft);
      else clearDraftBackup(backupKey);
    });
    let serverPage = page();
    f.api.save.mockImplementation(async (_id, body) => {
      if (body.expectedVersion !== serverPage.version) {
        throw {
          name: "ApiRequestError",
          status: 409,
          message: "Version changed",
          code: "page_version_conflict",
        };
      }
      serverPage = {
        ...serverPage,
        title: body.title,
        document: body.document,
        version: serverPage.version + 1,
      };
      throw new TypeError("Response lost after commit");
    });
    try {
      await f.session.begin(page());
      change(f.session, "committed remotely");
      await f.session.save();
      expect(serverPage).toMatchObject({ title: "committed remotely", version: 8 });
      // Reverting to the previous acknowledged text must still be treated as
      // unsaved because the failed response left the actual server state unknown.
      change(f.session, page().title);
      expect(f.session.getSnapshot()).toMatchObject({
        dirty: true,
        status: "error",
        draft: { title: page().title },
      });
      expect(readDraftBackup(backupKey)?.title).toBe(page().title);
      expect(await f.session.finish()).toBe(false);
      expect(f.api.save).toHaveBeenCalledTimes(2);
      expect(f.api.release).not.toHaveBeenCalled();
      expect(f.session.getSnapshot()).toMatchObject({
        mode: "lost",
        dirty: true,
        status: "stopped",
        draft: { title: page().title },
      });
      expect(readDraftBackup(backupKey)?.title).toBe(page().title);
      expect(draftText(readDraftBackup(backupKey)!)).toContain(page().title);
      expect(serverPage.title).toBe("committed remotely");
    } finally {
      unsubscribe();
      clearDraftBackup(backupKey);
    }
  });

  it.each([401, 403, 404, 409])(
    "stops on HTTP %i without dropping input or resending",
    async (status) => {
      const f = setup();
      await f.session.begin(page());
      change(f.session);
      f.api.save.mockRejectedValueOnce({
        name: "ApiRequestError",
        status,
        message: "Stopped",
        code: "edit_lease_lost",
      });
      await f.session.save();
      const stopped = f.session.getSnapshot();
      expect(stopped).toMatchObject({
        mode: "lost",
        dirty: true,
        status: "stopped",
        draft: { title: "未保存の入力" },
      });
      change(f.session, "cannot overwrite");
      await f.session.save();
      await f.session.renew();
      expect(f.session.getSnapshot().draft).toEqual(stopped.draft);
      expect(f.api.save).toHaveBeenCalledTimes(1);
      expect(f.api.renew).not.toHaveBeenCalled();
      expect(draftText(stopped.draft!)).toContain("未保存の入力");
    },
  );

  it("stops at the server lease deadline even when the local clock differs from the server", async () => {
    const f = setup();
    f.api.acquire.mockResolvedValueOnce(
      response({
        page: page(),
        lease: {
          serverNow: "2030-01-01T00:00:00.000Z",
          expiresAt: "2030-01-01T00:01:30.000Z",
        },
      }),
    );
    await f.session.begin(page());
    change(f.session);
    vi.setSystemTime(START + 89_999);
    f.session.tick();
    expect(f.session.getSnapshot().mode).toBe("edit");
    vi.setSystemTime(START + 90_000);
    f.session.tick();
    expect(f.session.getSnapshot()).toMatchObject({ mode: "lost", dirty: true, status: "stopped" });
    expect(f.api.release).toHaveBeenCalledWith(PAGE_ID);
    expect(f.session.getSnapshot().draft?.title).toBe("未保存の入力");
  });

  it("does not extend the lifetime by the duration of a delayed acquire response", async () => {
    const f = setup();
    const pending = deferred<ApiResult<SharedPageLeaseResponse>>();
    f.api.acquire.mockReturnValueOnce(pending.promise);
    const leaseAtStart = lease();
    const beginning = f.session.begin(page());
    vi.setSystemTime(START + 90_000);
    pending.resolve(response({ page: page(), lease: leaseAtStart }));
    await beginning;
    expect(f.session.getSnapshot().mode).toBe("lost");
    expect(f.api.release).toHaveBeenCalledWith(PAGE_ID);
  });

  it("relinquishes an idle editor after five minutes despite healthy heartbeats", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session);
    for (
      let elapsed = editTiming.heartbeat;
      elapsed < editTiming.idle;
      elapsed += editTiming.heartbeat
    ) {
      vi.setSystemTime(START + elapsed);
      await f.session.renew();
      expect(f.session.getSnapshot().mode).toBe("edit");
    }
    vi.setSystemTime(START + editTiming.idle);
    await f.session.renew();
    expect(f.session.getSnapshot().mode).toBe("lost");
    expect(f.api.release).toHaveBeenCalledWith(PAGE_ID);
  });

  it("permits only one renewal and does not revive after a late renewal reply", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session);
    const pending = deferred<ApiResult<SharedPageLease>>();
    f.api.renew.mockReturnValueOnce(pending.promise);
    const renewing = f.session.renew();
    await f.session.renew();
    expect(f.api.renew).toHaveBeenCalledTimes(1);
    vi.setSystemTime(START + 90_000);
    f.session.tick();
    pending.resolve(response(lease()));
    await renewing;
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "lost",
      status: "stopped",
      draft: { title: "未保存の入力" },
    });
    await f.session.save();
    expect(f.api.save).not.toHaveBeenCalled();
  });

  it("does not revive or clear unsaved input on a late successful save after expiry", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session, "sent");
    const pending = deferred<ApiResult<SharedPage>>();
    f.api.save.mockReturnValueOnce(pending.promise);
    const saving = f.session.save();
    change(f.session, "newer local input");
    vi.setSystemTime(START + 90_000);
    f.session.tick();
    pending.resolve(response(page("sent", 8)));
    expect(await saving).toBeNull();
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "lost",
      status: "stopped",
      dirty: true,
      busy: false,
      draft: { title: "newer local input" },
    });
  });

  it("preserves the draft and stops when lease renewal cannot be confirmed", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session);
    f.api.renew.mockRejectedValueOnce(new Error("offline"));
    await f.session.renew();
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "lost",
      draft: { title: "未保存の入力" },
      status: "stopped",
    });
    expect(f.session.getSnapshot().error).toContain("入力内容は残っています");
  });

  it("finishes only after successful saving and keeps the lease on recoverable failure", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session);
    f.api.save.mockRejectedValueOnce(new Error("offline"));
    expect(await f.session.finish()).toBe(false);
    expect(f.api.release).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().draft?.title).toBe("未保存の入力");
    expect(await f.session.finish()).toBe(true);
    expect(f.session.getSnapshot()).toMatchObject({ mode: "read", draft: null, dirty: false });
    expect(f.api.release).toHaveBeenCalledWith(PAGE_ID);
  });

  it("does not finish or discard while a save is in flight, or when new typing remains", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session, "sent");
    const pending = deferred<ApiResult<SharedPage>>();
    f.api.save.mockReturnValueOnce(pending.promise);
    const finishing = f.session.finish();
    expect(await f.session.finish()).toBe(false);
    f.session.discard();
    expect(f.session.getSnapshot().draft?.title).toBe("sent");
    change(f.session, "more");
    pending.resolve(response(page("sent", 8)));
    expect(await finishing).toBe(false);
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "edit",
      dirty: true,
      draft: { title: "more" },
    });
    expect(f.api.release).not.toHaveBeenCalled();
  });

  it("does not change a later local edit when an earlier release response arrives", async () => {
    const f = setup();
    await f.session.begin(page());
    const releasePending = deferred<ApiResult<Record<string, never>>>();
    f.api.release.mockReturnValueOnce(releasePending.promise);
    f.session.discard();
    f.api.acquire.mockResolvedValueOnce(response({ page: page(), lease: lease() }));
    await f.session.begin(page());
    releasePending.resolve(response({}));
    await releasePending.promise;
    expect(f.session.getSnapshot().mode).toBe("edit");
    expect(f.api.release.mock.calls[0]).toEqual([PAGE_ID]);
    change(f.session);
    await f.session.save();
    expect(f.api.save).toHaveBeenCalledWith(
      PAGE_ID,
      expect.objectContaining({ expectedVersion: 7 }),
      expect.any(Object),
    );
  });

  it("ignores a failed renewal from an old lease after another edit session starts", async () => {
    const f = setup();
    await f.session.begin(page());
    const pending = deferred<ApiResult<SharedPageLease>>();
    f.api.renew.mockReturnValueOnce(pending.promise);
    const renewing = f.session.renew();
    expect(await f.session.finish()).toBe(true);
    f.api.acquire.mockResolvedValueOnce(response({ page: page(), lease: lease() }));
    await f.session.begin(page());
    change(f.session, "new session draft");
    pending.reject({ name: "ApiRequestError", status: 409, message: "old lease lost" });
    await renewing;
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "edit",
      draft: { title: "new session draft" },
      status: "dirty",
    });
    await f.session.save();
    expect(f.api.save).toHaveBeenCalledWith(
      PAGE_ID,
      expect.objectContaining({ expectedVersion: 7 }),
      expect.any(Object),
    );
  });

  it("ignores an earlier renewal response instead of changing a newly acquired local deadline", async () => {
    const f = setup();
    await f.session.begin(page());
    const previous = lease();
    const pending = deferred<ApiResult<SharedPageLease>>();
    f.api.renew.mockReturnValueOnce(pending.promise);
    const renewing = f.session.renew();
    expect(await f.session.finish()).toBe(true);
    vi.setSystemTime(START + 10_000);
    await f.session.begin(page());
    change(f.session, "new local draft");
    pending.resolve(response(previous));
    await renewing;
    vi.setSystemTime(START + 90_000);
    f.session.tick();
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "edit",
      draft: { title: "new local draft" },
    });
    vi.setSystemTime(START + 100_000);
    f.session.tick();
    expect(f.session.getSnapshot().mode).toBe("lost");
  });

  it("does not ask the route to navigate after a delayed deletion succeeds on a disposed editor", async () => {
    const f = setup();
    await f.session.begin(page());
    const pending = deferred<ApiResult<Record<string, never>>>();
    f.api.remove.mockReturnValueOnce(pending.promise);
    const removing = f.session.remove(page());
    f.session.dispose();
    pending.resolve(response({}));
    expect(await removing).toBe(false);
  });

  it("aborts requests and ignores a delayed save when the editor unmounts", async () => {
    const f = setup();
    await f.session.begin(page());
    change(f.session);
    const pending = deferred<ApiResult<SharedPage>>();
    f.api.save.mockReturnValueOnce(pending.promise);
    const saving = f.session.save();
    const signal = f.api.save.mock.calls[0][2]?.signal;
    f.saved.mockClear();
    f.session.dispose();
    expect(signal?.aborted).toBe(true);
    pending.resolve(response(page("late", 8)));
    await saving;
    expect(f.saved).not.toHaveBeenCalled();
    expect(f.api.release).toHaveBeenCalledWith(PAGE_ID);
  });

  it("releases a late acquired lease after unmount and does not display its content", async () => {
    const f = setup();
    const pending = deferred<ApiResult<SharedPageLeaseResponse>>();
    f.api.acquire.mockReturnValueOnce(pending.promise);
    const beginning = f.session.begin(page());
    f.session.dispose();
    expect(f.api.acquire.mock.calls[0][1]?.signal?.aborted).toBe(true);
    pending.resolve(response({ page: page(), lease: lease() }));
    await beginning;
    expect(f.api.release).toHaveBeenCalledWith(PAGE_ID);
    expect(f.saved).not.toHaveBeenCalled();
  });

  it("blocks invalid drafts before sending them and leaves the original input intact", async () => {
    const f = setup(true);
    f.session.change({ title: " ", document });
    expect(await f.session.save()).toBeNull();
    expect(f.api.create).not.toHaveBeenCalled();
    expect(f.session.getSnapshot()).toMatchObject({
      mode: "new",
      status: "error",
      draft: { title: " " },
    });
  });

  it("creates a page only once while a creation request is pending", async () => {
    const f = setup(true);
    change(f.session, "New");
    const pending = deferred<ApiResult<SharedPage>>();
    f.api.create.mockReturnValueOnce(pending.promise);
    const saving = f.session.save();
    expect(await f.session.save()).toBeNull();
    expect(f.api.create).toHaveBeenCalledTimes(1);
    pending.resolve(response(page("New", 0)));
    await saving;
    expect(f.saved).toHaveBeenCalledWith(page("New", 0));
  });

  it("acquires a read-only page before deleting and rejects a stale confirmation", async () => {
    const f = setup();
    f.api.acquire.mockResolvedValueOnce(response({ page: page("updated", 8), lease: lease() }));
    f.api.remove.mockRejectedValueOnce({
      name: "ApiRequestError",
      status: 409,
      message: "version changed",
    });
    expect(await f.session.remove(page("old", 7))).toBe(false);
    expect(f.api.remove).toHaveBeenCalledWith(PAGE_ID, { expectedVersion: 7 }, expect.any(Object));
    expect(f.api.release).toHaveBeenCalledWith(PAGE_ID);
    expect(f.session.getSnapshot().error).toContain("ページが更新");
  });

  it("exports unsaved title, nested text, check state and links without touching server data", () => {
    const draft: PageDraft = {
      title: "未保存の計画",
      document: {
        format: "blocknote",
        schemaVersion: 1,
        blocks: [
          {
            id: "checked",
            type: "checkListItem",
            props: { checked: true },
            content: [{ type: "text", text: "ホテル", styles: { bold: true } }],
            children: [
              {
                id: "detail",
                type: "paragraph",
                props: {},
                content: [
                  {
                    type: "link",
                    href: "https://example.com",
                    content: [{ type: "text", text: "予約先", styles: {} }],
                  },
                ],
                children: [],
              },
            ],
          },
          {
            id: "unchecked",
            type: "checkListItem",
            props: { checked: false },
            content: [{ type: "text", text: "切符", styles: {} }],
            children: [],
          },
        ],
      },
    };
    expect(draftText(draft)).toBe(
      "未保存の計画\n\n☑ ホテル\n  予約先 (https://example.com)\n☐ 切符",
    );
  });
});
