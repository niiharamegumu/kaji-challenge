import equal from "fast-deep-equal";
import {
  CreateSharedPageSchema,
  type SharedPage,
  type SharedPageDocument,
  type SharedPageLease,
} from "../../../contracts/shared-pages";
import { isApiRequestError } from "../../../lib/api/api-client-state";
import { sharedPagesApi } from "../api/sharedPagesApi";

export type PageDraft = { title: string; document: SharedPageDocument };
export type EditSnapshot = {
  mode: "read" | "new" | "edit" | "lost";
  draft: PageDraft | null;
  dirty: boolean;
  busy: boolean;
  status: "unchanged" | "saved" | "dirty" | "saving" | "error" | "stopped";
  error: string | null;
  editorKey: number;
};

const emptyDraft = (): PageDraft => ({
  title: "",
  document: { format: "blocknote", schemaVersion: 1, blocks: [] },
});
const sameDraft = (draft: PageDraft, baseline: PageDraft | null) =>
  baseline !== null && draft.title === baseline.title && equal(draft.document, baseline.document);
export const editTiming = { heartbeat: 25_000, idle: 5 * 60_000, autosave: 800 } as const;

export function isEditingByAnotherUser(
  editing: SharedPage["editing"] | undefined,
  userId: string | null,
) {
  return editing != null && editing.userId !== userId;
}

/** Keeps one screen's draft and pending requests separate from the server's user-owned lease. */
export class PageEditSession {
  private snapshot: EditSnapshot;
  private listeners = new Set<() => void>();
  private baseline: PageDraft | null;
  private baselineStatus: "unchanged" | "saved" = "unchanged";
  private pageId: string | null = null;
  private version = 0;
  private creationRequestId?: string;
  private lease: SharedPageLease | null = null;
  private deadline = 0;
  private lastActivity = Date.now();
  private renewing = false;
  private pendingRelease?: Promise<void>;
  private alive = true;
  private abort = new AbortController();

  constructor(
    newPage: boolean,
    private saved: (page: SharedPage) => void,
    private api = sharedPagesApi,
  ) {
    const draft = newPage ? emptyDraft() : null;
    this.baseline = draft;
    this.snapshot = {
      mode: newPage ? "new" : "read",
      draft,
      dirty: false,
      busy: false,
      status: newPage ? "dirty" : "unchanged",
      error: null,
      editorKey: 0,
    };
  }

  getSnapshot = () => this.snapshot;
  restartNew = () => {
    this.creationRequestId = undefined;
    const draft = emptyDraft();
    this.baseline = draft;
    this.publish({
      mode: "new",
      draft,
      dirty: false,
      busy: false,
      status: "dirty",
      error: null,
      editorKey: this.snapshot.editorKey + 1,
    });
  };
  restore = (draft: PageDraft) => {
    this.publish({
      draft,
      mode: "lost",
      dirty: true,
      status: "stopped",
      error:
        "このタブに未保存の入力が残っています。入力をコピーしてから最新のページを確認してください。自動では保存しません。",
      editorKey: this.snapshot.editorKey + 1,
    });
  };
  activate = () => {
    this.alive = true;
    this.abort = new AbortController();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<EditSnapshot>) {
    if (!this.alive) return;
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
  private acceptLease(lease: SharedPageLease, started: number) {
    this.lease = lease;
    // Measure from the beginning of the request, not its delayed response.
    this.deadline =
      started + Math.max(0, Date.parse(lease.expiresAt) - Date.parse(lease.serverNow));
  }
  activity = () => {
    this.lastActivity = Date.now();
  };
  changeTitle = (title: string) => {
    if (this.snapshot.draft) this.change({ ...this.snapshot.draft, title });
  };
  changeDocument = (document: SharedPageDocument) => {
    if (this.snapshot.draft) this.change({ ...this.snapshot.draft, document });
  };
  change = (draft: PageDraft) => {
    if (this.snapshot.mode !== "edit" && this.snapshot.mode !== "new") return;
    this.activity();
    const { status, mode } = this.snapshot;
    // A pending or failed request may have committed a different draft.
    if (status === "saving" || status === "error") {
      this.publish({ draft, dirty: true });
      return;
    }
    const dirty = !sameDraft(draft, this.baseline);
    this.publish({
      draft,
      dirty,
      status: dirty || mode === "new" ? "dirty" : this.baselineStatus,
    });
  };
  private stop(message: string) {
    this.publish({ mode: "lost", status: "stopped", error: message });
  }
  tick = () => {
    if (this.snapshot.mode !== "edit") return;
    if (Date.now() >= this.deadline || Date.now() - this.lastActivity >= editTiming.idle) {
      this.stop(
        "編集できる時間が切れました。入力内容は残っています。コピーしてから最新のページを確認してください。",
      );
      this.releaseQuietly();
    }
  };
  renew = async () => {
    this.tick();
    if (this.snapshot.mode !== "edit" || !this.lease || !this.pageId || this.renewing) return;
    this.renewing = true;
    const lease = this.lease;
    const started = Date.now();
    try {
      const { data } = await this.api.renew(this.pageId, { signal: this.abort.signal });
      if (this.alive && this.snapshot.mode === "edit" && this.lease === lease) {
        this.acceptLease(data, started);
        this.tick();
      }
    } catch {
      if (this.alive && this.snapshot.mode === "edit" && this.lease === lease) {
        this.stop(
          "編集権を確認できないため、編集を停止しました。入力内容は残っています。コピーしてから最新のページを確認してください。",
        );
      }
    } finally {
      this.renewing = false;
    }
  };
  begin = async (page: SharedPage) => {
    if (this.snapshot.busy || this.snapshot.mode !== "read") return;
    this.publish({ busy: true, error: null });
    try {
      if (this.pendingRelease) await this.pendingRelease;
      if (!this.alive) return;
      const started = Date.now();
      const { data } = await this.api.acquire(page.id, { signal: this.abort.signal });
      if (!this.alive) {
        void this.api.release(page.id).catch(() => {});
        return;
      }
      this.pageId = data.page.id;
      this.version = data.page.version;
      this.acceptLease(data.lease, started);
      const draft = { title: data.page.title, document: data.page.document };
      this.baseline = draft;
      this.baselineStatus = "unchanged";
      this.activity();
      this.saved(data.page);
      this.publish({
        mode: "edit",
        draft,
        dirty: false,
        status: this.baselineStatus,
        editorKey: this.snapshot.editorKey + 1,
      });
      this.tick();
    } catch {
      this.publish({
        error:
          "編集を開始できませんでした。ほかの人が編集中の場合は、編集が終わってからお試しください。",
      });
    } finally {
      this.publish({ busy: false });
    }
  };
  save = async (): Promise<SharedPage | null> => {
    this.tick();
    const draft = this.snapshot.draft;
    if (this.snapshot.busy || !draft || !["edit", "new"].includes(this.snapshot.mode)) return null;
    const parsed = CreateSharedPageSchema.safeParse(draft);
    if (!parsed.success) {
      this.publish({
        status: "error",
        dirty: true,
        error:
          "保存できませんでした。タイトルは1〜200文字、本文は256KB・1000ブロック以内にしてください。リンクには http / https / mailto / tel が使えます。入力内容はこの画面に残っています。",
      });
      return null;
    }
    const isNew = this.snapshot.mode === "new";
    if (!isNew && (!this.lease || !this.pageId)) return null;
    this.publish({ busy: true, status: "saving", error: null });
    try {
      const result = isNew
        ? await this.api.create(
            { ...parsed.data, requestId: (this.creationRequestId ??= crypto.randomUUID()) },
            { signal: this.abort.signal },
          )
        : await this.api.save(
            this.pageId!,
            { ...parsed.data, expectedVersion: this.version },
            { signal: this.abort.signal },
          );
      if (!this.alive) return null;
      this.saved(result.data);
      // A late successful reply must not revive an expired lease or replace newer typing.
      if (this.snapshot.mode === "lost") return null;
      this.version = result.data.version;
      this.baseline = draft;
      this.baselineStatus = "saved";
      const dirty = this.snapshot.draft != null && !sameDraft(this.snapshot.draft, draft);
      this.publish({ dirty, status: dirty ? "dirty" : "saved" });
      return result.data;
    } catch (error) {
      if (!this.alive) return null;
      if (isNew && isApiRequestError(error) && error.code === "page_creation_conflict") {
        this.stop(
          "先ほど作成したページと現在の入力が一致しないか、ページが更新・削除されています。入力をコピーし、共有ページ一覧を確認してください。",
        );
      } else if (isApiRequestError(error) && [401, 403, 404, 409].includes(error.status)) {
        this.stop(
          "編集権またはページの更新を確認できないため、編集を停止しました。入力内容は残っています。コピーしてから最新のページを確認してください。",
        );
      } else if (this.snapshot.mode !== "lost") {
        this.publish({
          status: "error",
          dirty: true,
          error:
            "保存できませんでした。入力内容はこの画面に残っています。接続を確認して再試行してください。",
        });
      }
      return null;
    } finally {
      this.publish({ busy: false });
    }
  };
  finish = async () => {
    if (this.snapshot.mode !== "edit" || this.snapshot.busy) return false;
    if ((this.snapshot.dirty || this.snapshot.status === "error") && !(await this.save()))
      return false;
    if (this.snapshot.dirty || this.snapshot.mode !== "edit") return false;
    this.releaseQuietly();
    this.publish({ mode: "read", draft: null, dirty: false, status: "saved", error: null });
    // The route refreshes ownership after release has reached the server.
    await this.pendingRelease;
    const current = this.getSnapshot();
    return this.alive && current.mode === "read" && !current.busy;
  };
  discard = () => {
    if (this.snapshot.busy) return;
    this.releaseQuietly();
    this.publish({ mode: "read", draft: null, dirty: false, status: "saved", error: null });
  };
  remove = async (page: SharedPage) => {
    if (this.snapshot.busy) return false;
    this.tick();
    if (this.snapshot.mode === "lost") return false;
    this.publish({ busy: true, error: null });
    let acquired: SharedPageLease | null = null;
    try {
      const ownLease = this.snapshot.mode === "edit" ? this.lease : null;
      if (!ownLease) {
        if (this.pendingRelease) await this.pendingRelease;
        if (!this.alive) return false;
        acquired = (await this.api.acquire(page.id, { signal: this.abort.signal })).data.lease;
        if (!this.alive) {
          void this.api.release(page.id).catch(() => {});
          return false;
        }
      }
      await this.api.remove(
        page.id,
        {
          expectedVersion: ownLease ? this.version : page.version,
        },
        { signal: this.abort.signal },
      );
      if (!this.alive) return false;
      this.lease = null;
      this.publish({ mode: "read", draft: null, dirty: false, status: "saved", error: null });
      return true;
    } catch {
      if (acquired) this.release(page.id);
      this.publish({
        error:
          "削除できませんでした。ほかの人が編集中か、ページが更新されています。最新の状態を確認してください。",
      });
      return false;
    } finally {
      this.publish({ busy: false });
    }
  };
  private release(pageId: string) {
    // A new acquire in this screen must not overtake its earlier release.
    this.pendingRelease = this.api.release(pageId).then(
      () => {},
      () => {}, // The lease expires when release cannot be delivered.
    );
  }
  private releaseQuietly() {
    if (this.lease && this.pageId) this.release(this.pageId);
    this.lease = null;
  }
  dispose = () => {
    this.alive = false;
    this.abort.abort();
    this.releaseQuietly();
  };
}

export function draftText(draft: PageDraft) {
  const lines: string[] = [draft.title, ""];
  const visit = (blocks: SharedPageDocument["blocks"], level = 0) => {
    for (const block of blocks) {
      const prefix =
        block.type === "checkListItem"
          ? block.props.checked
            ? "☑ "
            : "☐ "
          : block.type.endsWith("ListItem")
            ? "・"
            : "";
      lines.push(
        "  ".repeat(level) +
          prefix +
          block.content
            .map((content) =>
              content.type === "text"
                ? content.text
                : content.content.map((text) => text.text).join("") + ` (${content.href})`,
            )
            .join(""),
      );
      visit(block.children, level + 1);
    }
  };
  visit(draft.document.blocks);
  return lines.join("\n");
}
