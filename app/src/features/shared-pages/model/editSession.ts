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
const fingerprint = (draft: PageDraft) => JSON.stringify(draft);
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
  private baseline: string;
  private baselineStatus: "unchanged" | "saved" = "unchanged";
  private pageId: string | null = null;
  private version = 0;
  private lease: SharedPageLease | null = null;
  private deadline = 0;
  private lastActivity = Date.now();
  private renewing = false;
  private alive = true;
  private abort = new AbortController();

  constructor(
    newPage: boolean,
    private saved: (page: SharedPage) => void,
    private api = sharedPagesApi,
  ) {
    const draft = newPage ? emptyDraft() : null;
    this.baseline = draft ? fingerprint(draft) : "";
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
    const draft = emptyDraft();
    this.baseline = fingerprint(draft);
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
  change = (draft: PageDraft) => {
    if (this.snapshot.mode !== "edit" && this.snapshot.mode !== "new") return;
    this.activity();
    const { status, mode } = this.snapshot;
    // A pending or failed request may have committed a different draft.
    if (status === "saving" || status === "error") {
      this.publish({ draft, dirty: true });
      return;
    }
    const dirty = fingerprint(draft) !== this.baseline;
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
    const started = Date.now();
    try {
      const { data } = await this.api.acquire(page.id, { signal: this.abort.signal });
      if (!this.alive) {
        void this.api.release(page.id).catch(() => {});
        return;
      }
      this.pageId = data.page.id;
      this.version = data.page.version;
      this.acceptLease(data.lease, started);
      const draft = { title: data.page.title, document: data.page.document };
      this.baseline = fingerprint(draft);
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
    const sent = fingerprint(draft);
    this.publish({ busy: true, status: "saving", error: null });
    try {
      const result = isNew
        ? await this.api.create(parsed.data, { signal: this.abort.signal })
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
      this.baseline = sent;
      this.baselineStatus = "saved";
      const dirty = this.snapshot.draft != null && fingerprint(this.snapshot.draft) !== sent;
      this.publish({ dirty, status: dirty ? "dirty" : "saved" });
      return result.data;
    } catch (error) {
      if (!this.alive) return null;
      if (isApiRequestError(error) && [401, 403, 404, 409].includes(error.status)) {
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
    return true;
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
      if (!ownLease)
        acquired = (await this.api.acquire(page.id, { signal: this.abort.signal })).data.lease;
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
      this.publish({
        error:
          "削除できませんでした。ほかの人が編集中か、ページが更新されています。最新の状態を確認してください。",
      });
      return false;
    } finally {
      if (acquired) void this.api.release(page.id).catch(() => {});
      this.publish({ busy: false });
    }
  };
  private releaseQuietly() {
    if (this.lease && this.pageId) {
      void this.api.release(this.pageId).catch(() => {
        // The server's short lease expires even when release cannot be delivered.
      });
    }
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
