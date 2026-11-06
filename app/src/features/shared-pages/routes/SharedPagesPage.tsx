import { useBlocker } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import {
  ArrowLeft,
  Check,
  Ellipsis,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import type { TeamMember } from "../../../contracts/models";
import type { SharedPageSummary } from "../../../contracts/shared-pages";
import { DeleteConfirmModal } from "../../../shared/components/DeleteConfirmModal";
import {
  sharedPageQueryOptions,
  sharedPagesQueryOptions,
} from "../../../shared/query/sharedPageQueries";
import { queryKeys } from "../../../shared/query/queryKeys";
import { teamMembersQueryOptions } from "../../../shared/query/teamMembersQuery";
import { Link, useNavigate, useOutletContext } from "../../../shared/router/navigation";
import type { RootLayoutOutletContext } from "../../../shared/router/rootLayoutContext";
import { sharedPageDraftDirtyAtom } from "../../../shared/state/sharedPageDraft";
import { useFormPresence } from "../../../shared/state/overlay";
import { getReadableTextColor, resolveUserColor } from "../../../shared/utils/userColor";
import {
  PageEditSession,
  draftText,
  editTiming,
  isEditingByAnotherUser,
} from "../model/editSession";
import {
  clearDraftBackup,
  draftBackupKey,
  readDraftBackup,
  writeDraftBackup,
} from "../model/draftBackup";
import "../shared-pages.css";

const PageEditor = lazy(async () => ({
  default: (await import("../components/PageEditor")).PageEditor,
}));
const timestamp = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function SharedPagesPage(props: { pageId?: string; newPage?: boolean }) {
  const { currentTeamId, currentUserId } = useOutletContext<RootLayoutOutletContext>();
  return (
    <SharedPagesContent
      key={`${currentUserId}:${currentTeamId}:${props.pageId ?? (props.newPage ? "new" : "list")}`}
      recoveryKey={draftBackupKey(currentUserId ?? "", currentTeamId ?? "", props.pageId ?? "new")}
      currentUserId={currentUserId}
      {...props}
    />
  );
}

function SharedPagesContent({
  pageId,
  newPage = false,
  recoveryKey,
  currentUserId,
}: {
  pageId?: string;
  newPage?: boolean;
  recoveryKey: string;
  currentUserId: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ ...sharedPagesQueryOptions, refetchInterval: 30_000 });
  const members = useQuery(teamMembersQueryOptions);
  const query = useQuery({
    ...sharedPageQueryOptions(pageId ?? ""),
    enabled: Boolean(pageId),
    refetchInterval: 30_000,
  });
  const [backupWarning, setBackupWarning] = useState(false);
  const [session] = useState(() => {
    const created = new PageEditSession(newPage, (page) => {
      queryClient.setQueryData(sharedPageQueryOptions(page.id).queryKey, page);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sharedPages, exact: true });
    });
    if (pageId || newPage) {
      const restored = readDraftBackup(recoveryKey);
      if (restored) created.restore(restored);
      created.subscribe(() => {
        const snapshot = created.getSnapshot();
        const persisted =
          snapshot.dirty && snapshot.draft
            ? writeDraftBackup(recoveryKey, snapshot.draft)
            : clearDraftBackup(recoveryKey);
        setBackupWarning(!persisted);
      });
    }
    return created;
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [composing, setComposing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [latestRequested, setLatestRequested] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const setDraftDirty = useSetAtom(sharedPageDraftDirtyAtom);
  const hasUnsaved = state.dirty || state.busy;
  const blocker = useBlocker({
    shouldBlockFn: () => session.getSnapshot().dirty || session.getSnapshot().busy,
    withResolver: true,
    enableBeforeUnload: hasUnsaved,
  });
  const showLeave = blocker.status === "blocked" || latestRequested;
  useFormPresence(showLeave || copyFallback !== null);

  useEffect(() => {
    session.activate();
    const heartbeat = window.setInterval(() => {
      void session.renew();
    }, editTiming.heartbeat);
    const expiry = window.setInterval(session.tick, 1000);
    document.addEventListener("visibilitychange", session.tick);
    window.addEventListener("online", session.tick);
    return () => {
      window.clearInterval(heartbeat);
      window.clearInterval(expiry);
      document.removeEventListener("visibilitychange", session.tick);
      window.removeEventListener("online", session.tick);
      session.dispose();
    };
  }, [session]);
  useEffect(() => {
    setDraftDirty(hasUnsaved);
    return () => {
      setDraftDirty(false);
    };
  }, [hasUnsaved, setDraftDirty]);
  useEffect(() => {
    if (
      state.mode !== "edit" ||
      !state.dirty ||
      state.busy ||
      state.status === "error" ||
      composing ||
      showLeave ||
      deleting
    )
      return;
    const timeout = window.setTimeout(() => {
      void session.save();
    }, editTiming.autosave);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    session,
    state.mode,
    state.dirty,
    state.busy,
    state.status,
    state.draft,
    composing,
    showLeave,
    deleting,
  ]);

  const copy = async () => {
    if (!state.draft) return;
    const text = draftText(state.draft);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopyFallback(text);
    }
  };
  const refreshLatest = () => {
    if (hasUnsaved) {
      setLatestRequested(true);
      return;
    }
    if (newPage) session.restartNew();
    else {
      session.discard();
      void query.refetch();
    }
  };
  const savePage = async () => {
    const savedPage = await session.save();
    if (newPage && savedPage && !session.getSnapshot().dirty)
      navigate(`/pages/${savedPage.id}`, { replace: true });
  };
  const page = query.data;
  const detail = Boolean(pageId) || newPage;
  const editing = state.mode === "edit" || state.mode === "new";
  const stopped = state.mode === "lost";
  const draft = state.draft;
  // The server decides lease expiry; reconnect/polling refreshes this snapshot.
  const locked = isEditingByAnotherUser(page?.editing, currentUserId);
  const editLabel = state.busy ? "確認中…" : locked ? "編集中" : "編集する";
  const label =
    state.status === "saving"
      ? "保存中…"
      : state.status === "error"
        ? "保存失敗"
        : state.status === "stopped"
          ? "編集を停止"
          : state.dirty || newPage
            ? "未保存"
            : "保存済み";

  return (
    <section className={detail ? "shared-pages-section pb-6" : "shared-pages-section mt-4 pb-8"}>
      <header
        className={`mb-5 items-center justify-between gap-3 ${detail ? "hidden md:flex" : "flex"}`}
      >
        <div>
          <h1 className="text-lg font-semibold text-heading">共有ページ</h1>
          <p className="mt-2 text-sm text-secondary">メモも、計画も、ふたりの好きな形で。</p>
        </div>
        <Link
          to="/pages/new"
          className="shared-page-icon-button shared-page-icon-button--primary"
          aria-label="ページを作成"
          title="ページを作成"
        >
          <Plus size={16} aria-hidden="true" />
        </Link>
      </header>
      <div className="shared-pages-layout" data-detail={detail}>
        <aside className="shared-pages-list" aria-label="共有ページ一覧">
          {list.isPending ? (
            <p className="py-8 text-sm text-secondary" role="status">
              ページを読み込んでいます…
            </p>
          ) : null}
          {list.isError ? (
            <div role="alert" className="mb-3 text-sm text-danger">
              一覧を取得できませんでした。
              <button className="shared-page-text-button" onClick={() => void list.refetch()}>
                再読み込み
              </button>
            </div>
          ) : null}
          {list.data?.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong p-8 text-center">
              <FileText size={28} aria-hidden="true" className="mx-auto text-muted" />
              <h2 className="mt-4 font-semibold text-heading">ふたりのページをはじめよう</h2>
              <p className="mt-2 text-sm leading-7 text-secondary">
                行きたいお店、旅行の計画、暮らしのメモ。好きなことを自由に書きとめられます。
              </p>
            </div>
          ) : null}
          <div className={detail ? "space-y-1" : "grid gap-3 md:grid-cols-2"}>
            {list.data?.map((item) => (
              <PageListItem
                key={item.id}
                page={item}
                selected={pageId === item.id}
                editorMember={members.data?.find(
                  (member) => member.userId === item.editing?.userId,
                )}
              />
            ))}
          </div>
        </aside>
        {detail ? (
          <article className="shared-page-sheet" aria-label="共有ページ本文">
            <div
              className="shared-page-toolbar"
              onPointerDown={session.activity}
              onKeyDown={session.activity}
            >
              <button
                type="button"
                className="shared-page-icon-button"
                aria-label="共有ページへ戻る"
                title="共有ページへ戻る"
                onClick={() => navigate("/pages")}
              >
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
              <div className="flex-1" />
              {page?.editing ? (
                <EditingUserAvatar
                  editing={page.editing}
                  member={members.data?.find((member) => member.userId === page.editing?.userId)}
                />
              ) : null}
              {editing || stopped ? (
                <>
                  <span
                    className={`inline-flex items-center gap-1 text-xs ${state.status === "error" ? "text-danger" : stopped ? "text-warning" : "text-secondary"}`}
                    role="status"
                    aria-live="polite"
                  >
                    {state.status === "saving" ? (
                      <LoaderCircle
                        size={14}
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : state.status === "saved" && !state.dirty && !newPage ? (
                      <Check size={14} aria-hidden="true" className="text-success" />
                    ) : null}
                    {label}
                  </span>
                  {newPage ? (
                    <button
                      type="button"
                      className="shared-page-icon-button shared-page-icon-button--primary"
                      aria-label="作成する"
                      title="作成する"
                      aria-busy={state.busy}
                      disabled={state.busy || stopped || composing || !draft?.title.trim()}
                      onClick={() => void savePage()}
                    >
                      <Check size={16} aria-hidden="true" />
                    </button>
                  ) : (
                    <>
                      <span className="hidden md:inline-flex">
                        <button
                          type="button"
                          className="shared-page-icon-button"
                          aria-label="保存する"
                          title="保存する"
                          disabled={state.busy || stopped || composing || !state.dirty}
                          onClick={() => void session.save()}
                        >
                          <Save size={16} aria-hidden="true" />
                        </button>
                      </span>
                      <button
                        type="button"
                        className="shared-page-icon-button shared-page-icon-button--success"
                        aria-label="完了"
                        title="完了"
                        aria-busy={state.busy}
                        disabled={state.busy || stopped || composing}
                        onClick={() => {
                          void session.finish().then((finished) => {
                            if (finished) void query.refetch();
                          });
                        }}
                      >
                        <Check size={16} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </>
              ) : page ? (
                <button
                  type="button"
                  className="shared-page-icon-button"
                  aria-label={editLabel}
                  title={editLabel}
                  aria-busy={state.busy}
                  disabled={state.busy || locked}
                  onClick={() => void session.begin(page)}
                >
                  {state.busy ? (
                    <LoaderCircle
                      size={16}
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : locked ? (
                    <LockKeyhole size={16} aria-hidden="true" />
                  ) : (
                    <Pencil size={16} aria-hidden="true" />
                  )}
                </button>
              ) : null}
              {page ? (
                <div className="relative">
                  <button
                    type="button"
                    className="shared-page-icon-button"
                    aria-label="ページの操作"
                    title="ページの操作"
                    aria-expanded={menuOpen}
                    disabled={state.busy || stopped}
                    onClick={() => setMenuOpen(!menuOpen)}
                  >
                    <Ellipsis size={16} aria-hidden="true" />
                  </button>
                  {menuOpen ? (
                    <div className="absolute right-0 top-full z-30 w-44 rounded-xl border border-line bg-surface p-1 shadow-lg">
                      <button
                        className="shared-page-text-button w-full text-danger"
                        onClick={() => {
                          setMenuOpen(false);
                          setDeleting(true);
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        ページを削除
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {backupWarning ? (
              <div
                role="alert"
                className="mx-5 mt-4 rounded-xl border border-warning-line bg-warning-soft p-3 text-sm leading-7 text-warning-strong"
              >
                このタブへの一時保存を更新できません。画面を閉じる前に入力をコピーしてください。
                {draft ? (
                  <button className="shared-page-text-button" onClick={() => void copy()}>
                    入力をコピー
                  </button>
                ) : null}
              </div>
            ) : null}
            {state.error ? (
              <div
                role="alert"
                className={`mx-5 mt-4 rounded-xl border p-4 text-sm leading-7 ${stopped ? "border-warning-line bg-warning-soft text-warning-strong" : "border-danger-line bg-danger-soft text-danger-strong"}`}
              >
                <p>{state.error}</p>
                {draft ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!stopped ? (
                      <button
                        className="shared-page-button"
                        disabled={state.busy || composing}
                        onClick={() => void savePage()}
                      >
                        再試行
                      </button>
                    ) : null}
                    <button
                      className="shared-page-text-button border border-line-strong"
                      onClick={() => void copy()}
                    >
                      入力をコピー
                    </button>
                    {stopped ? (
                      <button
                        className="shared-page-text-button border border-line-strong"
                        disabled={state.busy}
                        onClick={refreshLatest}
                      >
                        最新を確認
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <button className="shared-page-text-button" onClick={() => void query.refetch()}>
                    最新を確認
                  </button>
                )}
              </div>
            ) : null}
            {copied ? (
              <p role="status" className="mx-5 mt-2 text-sm text-success">
                入力内容をコピーしました。
              </p>
            ) : null}
            {query.isError ? (
              <div role="alert" className="mx-5 mt-4 text-sm text-danger">
                ページを取得できませんでした。
                {draft
                  ? "入力内容はこの画面に残っています。"
                  : "ページが削除されたか、アクセスできません。"}
                <button className="shared-page-text-button" onClick={() => void query.refetch()}>
                  再読み込み
                </button>
              </div>
            ) : null}
            {!editing && !stopped && locked && page?.editing ? (
              <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm leading-6 text-warning-strong">
                <LockKeyhole size={17} aria-hidden="true" className="mt-1 shrink-0" />
                <p>{page.editing.displayName}が編集中です。保存された内容を表示しています。</p>
              </div>
            ) : null}
            {query.isPending && !newPage ? (
              <p role="status" className="p-10 text-secondary">
                ページを読み込んでいます…
              </p>
            ) : null}
            {draft || page ? (
              <div
                className="shared-page-paper"
                onPointerDown={session.activity}
                onKeyDown={session.activity}
              >
                {draft ? (
                  <input
                    aria-label="タイトル"
                    placeholder="タイトル"
                    maxLength={200}
                    value={draft.title}
                    readOnly={!editing || (state.busy && newPage)}
                    onChange={(event) => session.change({ ...draft, title: event.target.value })}
                    onCompositionStart={() => setComposing(true)}
                    onCompositionEnd={() => setComposing(false)}
                    className="mb-6 w-full min-w-0 rounded-md border-0 bg-transparent py-1 text-2xl font-bold leading-relaxed text-heading outline-none placeholder:text-faint md:text-3xl"
                  />
                ) : (
                  <>
                    <p className="mb-4 text-xs text-muted">
                      {page!.updatedByName}が更新・{timestamp.format(new Date(page!.updatedAt))}
                    </p>
                    <h2 className="mb-6 break-words text-2xl font-bold leading-relaxed text-heading md:text-3xl">
                      {page!.title}
                    </h2>
                  </>
                )}
                <Suspense
                  fallback={
                    <p role="status" className="py-8 text-sm text-secondary">
                      本文を読み込んでいます…
                    </p>
                  }
                >
                  <PageEditor
                    key={draft ? `edit-${state.editorKey}` : `read-${page!.id}-${page!.version}`}
                    document={draft?.document ?? page!.document}
                    editable={editing && !(state.busy && newPage)}
                    onChange={(document) => {
                      const latest = session.getSnapshot().draft;
                      if (latest) session.change({ ...latest, document });
                    }}
                    onCompositionChange={setComposing}
                  />
                </Suspense>
                {!editing && !stopped ? (
                  <p className="mt-12 text-xs leading-6 text-muted">
                    チェックを変えるときは、上の鉛筆アイコンから編集できます。
                  </p>
                ) : null}
                {newPage ? (
                  <p className="mt-10 border-t border-line pt-4 text-xs leading-6 text-muted">
                    作成すると、同じチームのふたりに共有されます。
                  </p>
                ) : null}
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
      <DeleteConfirmModal
        isOpen={deleting}
        title="このページを削除しますか？"
        message={`「${page?.title ?? ""}」はふたりの一覧から削除されます。この操作は取り消せません。`}
        onCancel={() => {
          if (!state.busy) setDeleting(false);
        }}
        onConfirm={() => {
          if (!page || state.busy) return;
          void session.remove(page).then((removed) => {
            if (removed) {
              setDeleting(false);
              void queryClient.invalidateQueries({ queryKey: queryKeys.sharedPages });
              navigate("/pages", { replace: true });
            } else setDeleting(false);
          });
        }}
      />
      {showLeave ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-overlay/40 p-5">
          <dialog
            open
            aria-labelledby="shared-page-leave-title"
            className="m-auto w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl"
          >
            <h2 id="shared-page-leave-title" className="text-lg font-bold">
              保存していない変更があります
            </h2>
            <p className="mt-3 text-sm leading-7 text-secondary">
              {state.busy
                ? "通信の結果を確認しています。入力内容を残してお待ちください。"
                : "このまま戻ると、変更は保存されません。"}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                autoFocus
                className="shared-page-button"
                onClick={() => {
                  setLatestRequested(false);
                  blocker.reset?.();
                }}
              >
                編集を続ける
              </button>
              {draft ? (
                <button
                  className="shared-page-text-button border border-line-strong"
                  onClick={() => void copy()}
                >
                  入力をコピー
                </button>
              ) : null}
              <button
                className="shared-page-text-button text-danger"
                disabled={state.busy}
                onClick={() => {
                  if (newPage && latestRequested) session.restartNew();
                  else session.discard();
                  setLatestRequested(false);
                  if (blocker.status === "blocked") blocker.proceed();
                  else if (!newPage) void query.refetch();
                }}
              >
                変更を破棄して戻る
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
      {copyFallback !== null ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-overlay/40 p-5">
          <dialog
            open
            aria-label="入力内容をコピー"
            className="m-auto w-full max-w-lg rounded-2xl border border-line bg-surface p-5"
          >
            <p className="mb-3 text-sm">
              自動コピーが利用できません。本文を選択してコピーしてください。
            </p>
            <textarea
              aria-label="コピーする入力内容"
              className="h-64 w-full rounded-lg border border-line p-3 text-base"
              readOnly
              value={copyFallback}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button className="shared-page-button mt-3" onClick={() => setCopyFallback(null)}>
              閉じる
            </button>
          </dialog>
        </div>
      ) : null}
    </section>
  );
}

function EditingUserAvatar({
  editing,
  member,
  decorative = false,
}: {
  editing: NonNullable<SharedPageSummary["editing"]>;
  member?: TeamMember;
  decorative?: boolean;
}) {
  const name = member?.effectiveName ?? editing.displayName;
  const color = resolveUserColor(member?.colorHex);
  const label = `${name}が編集中`;
  return (
    <span
      role="img"
      aria-label={label}
      aria-hidden={decorative || undefined}
      title={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-glass-edge text-xs font-semibold"
      style={{ backgroundColor: color, color: getReadableTextColor(color) }}
    >
      {Array.from(name.trim())[0] ?? "?"}
    </span>
  );
}

function PageListItem({
  page,
  selected,
  editorMember,
}: {
  page: SharedPageSummary;
  selected: boolean;
  editorMember?: TeamMember;
}) {
  return (
    <Link
      to={`/pages/${page.id}`}
      aria-current={selected ? "page" : undefined}
      className={`flex min-w-0 gap-3 rounded-xl border p-4 transition-colors ${selected ? "border-success-line bg-success-soft" : "border-line bg-surface hover:bg-surface-subtle"}`}
    >
      <FileText size={20} aria-hidden="true" className="mt-1 shrink-0 text-secondary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-heading">{page.title}</span>
        <span className="mt-1 block truncate text-sm text-secondary">
          {page.preview || "まだ本文はありません"}
        </span>
        <span className="mt-2 block text-xs text-muted">
          {page.updatedByName}・{timestamp.format(new Date(page.updatedAt))}
        </span>
        {page.editing ? (
          <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-warning-soft px-2 py-1 text-xs text-warning-strong">
            <EditingUserAvatar editing={page.editing} member={editorMember} decorative />
            <span className="min-w-0 break-words">
              {editorMember?.effectiveName ?? page.editing.displayName}が編集中
            </span>
          </span>
        ) : null}
      </span>
    </Link>
  );
}
