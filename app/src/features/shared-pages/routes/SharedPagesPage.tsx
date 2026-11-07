import { useMediaQuery } from "@mantine/hooks";
import { useBlocker } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import equal from "fast-deep-equal";
import { useSetAtom } from "jotai";
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { TeamMember } from "../../../contracts/models";
import type { SharedPageSummary } from "../../../contracts/shared-pages";
import { DeleteConfirmModal } from "../../../shared/components/DeleteConfirmModal";
import { ConfirmModal } from "../../../shared/components/ConfirmModal";
import { InfoHelp } from "../../../shared/components/InfoHelp";
import { FormSheet } from "../../../shared/components/FormSheet";
import {
  sharedPageQueryOptions,
  sharedPagesQueryOptions,
} from "../../../shared/query/sharedPageQueries";
import { queryKeys } from "../../../shared/query/queryKeys";
import { teamMembersQueryOptions } from "../../../shared/query/teamMembersQuery";
import { Link, useNavigate, useOutletContext } from "../../../shared/router/navigation";
import type { RootLayoutOutletContext } from "../../../shared/router/rootLayoutContext";
import { sharedPageDraftDirtyAtom } from "../../../shared/state/sharedPageDraft";
import { getReadableTextColor, resolveUserColor } from "../../../shared/utils/userColor";
import {
  type EditSnapshot,
  PageEditSession,
  draftText,
  editTiming,
  isEditingByAnotherUser,
} from "../model/editSession";
import { draftBackupKey, readDraftBackup, syncDraftBackup } from "../model/draftBackup";
import { sharedPageSidebarMedia } from "../preload";
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

// The body is owned by BlockNote. The route only displays the title and edit status.
function selectPageControls({ draft, ...controls }: EditSnapshot) {
  return { ...controls, title: draft?.title };
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
  const wideScreen = useMediaQuery(sharedPageSidebarMedia, undefined, {
    getInitialValueInEffect: false,
  });
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
    }
    return created;
  });
  useEffect(() => {
    if (pageId || newPage) {
      return syncDraftBackup(recoveryKey, session, (ok) => setBackupWarning(!ok));
    }
  }, [pageId, newPage, recoveryKey, session]);
  const state = useSyncExternalStoreWithSelector(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
    selectPageControls,
    equal,
  );
  const [composing, setComposing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [latestRequested, setLatestRequested] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyInputRef = useRef<HTMLTextAreaElement>(null);
  const setDraftDirty = useSetAtom(sharedPageDraftDirtyAtom);
  const hasUnsaved = state.dirty || state.busy;
  const blocker = useBlocker({
    shouldBlockFn: () => session.getSnapshot().dirty || session.getSnapshot().busy,
    withResolver: true,
    enableBeforeUnload: hasUnsaved,
  });
  const showLeave = blocker.status === "blocked" || latestRequested;

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    session.activate();
    return session.dispose;
  }, [session]);
  useEffect(() => {
    if (state.mode !== "edit") return;
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
    };
  }, [session, state.mode]);
  useEffect(() => {
    setDraftDirty(hasUnsaved);
    return () => {
      setDraftDirty(false);
    };
  }, [hasUnsaved, setDraftDirty]);
  useEffect(() => {
    if (state.mode !== "edit" || composing || showLeave || deleting) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      const { mode, dirty, busy, status } = session.getSnapshot();
      if (mode === "edit" && dirty && !busy && status !== "error") {
        timer = window.setTimeout(() => void session.save(), editTiming.autosave);
      }
    };
    const unsubscribe = session.subscribe(schedule);
    schedule();
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [session, state.mode, composing, showLeave, deleting]);

  const copy = async () => {
    const { draft } = session.getSnapshot();
    if (!draft) return;
    const text = draftText(draft);
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
  const hasDraft = state.title !== undefined;
  // The server decides lease expiry; reconnect/polling refreshes this snapshot.
  const locked = isEditingByAnotherUser(page?.editing, currentUserId);
  const editLabel = state.busy ? "確認中…" : locked ? "編集中" : "編集する";
  const label = {
    unchanged: "変更なし",
    dirty: newPage ? "未作成" : "未保存",
    saving: newPage ? "作成中…" : "保存中…",
    saved: "保存済み",
    error: "保存失敗",
    stopped: "編集を停止",
  }[state.status];

  return (
    <section className={detail ? "shared-pages-section md:pb-6" : "shared-pages-section mt-4 pb-8"}>
      <header
        className={`mb-5 items-center justify-between gap-3 ${detail ? "hidden md:flex" : "flex"}`}
      >
        <div className="flex items-center gap-1">
          <h1 className="text-lg font-semibold text-heading">共有ページ</h1>
          {!detail && (
            <InfoHelp label="共有ページの使い方">
              ＋からページを作成できます。ページには文章やチェックリストを書き込めます。作成したページは同じチームのメンバーに共有されます。
            </InfoHelp>
          )}
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
        {(!detail || wideScreen) && (
          <PageList detail={detail} pageId={pageId} members={members.data} />
        )}
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
              <InfoHelp label={newPage ? "ページ作成の説明" : "ページ編集の説明"}>
                <p>
                  {newPage
                    ? "タイトルを入力し、右上の＋で作成します。作成すると、同じチームのメンバーに共有されます。"
                    : "鉛筆で編集を始めると、変更は自動保存されます。「保存済み」は現在の内容の保存が完了した状態です。目のアイコンで編集を終了して閲覧に戻ると、ほかのメンバーが編集できます。"}
                </p>
                <p>
                  編集中は、各項目の左端にあるハンドルをドラッグして順番を変えられます。
                  ハンドルをタップすると上下の矢印でも移動できます。入れ子の項目は親と一緒に移動します。
                </p>
              </InfoHelp>
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
                      disabled={state.busy || stopped || composing || !state.title?.trim()}
                      onClick={() => void savePage()}
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shared-page-icon-button"
                      aria-label="編集を終了"
                      title="編集を終了して閲覧に戻る"
                      aria-busy={state.busy}
                      disabled={state.busy || stopped || composing}
                      onClick={() => {
                        void session.finish().then((finished) => {
                          if (finished) void query.refetch();
                        });
                      }}
                    >
                      <Eye size={16} aria-hidden="true" />
                    </button>
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
                <button
                  type="button"
                  className="shared-page-icon-button shared-page-icon-button--danger"
                  aria-label="ページを削除"
                  title={locked ? "編集中は削除できません" : "ページを削除"}
                  disabled={state.busy || stopped || locked}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {backupWarning ? (
              <div
                role="alert"
                className="mx-5 mt-4 rounded-xl border border-warning-line bg-warning-soft p-3 text-sm leading-7 text-warning-strong"
              >
                このタブへの一時保存を更新できません。画面を閉じる前に入力をコピーしてください。
                {hasDraft ? <CopyDraftButton copied={copied} onCopy={() => void copy()} /> : null}
              </div>
            ) : null}
            {state.error ? (
              <div
                role="alert"
                className={`mx-5 mt-4 rounded-xl border p-4 text-sm leading-7 ${stopped ? "border-warning-line bg-warning-soft text-warning-strong" : "border-danger-line bg-danger-soft text-danger-strong"}`}
              >
                <p>{state.error}</p>
                {hasDraft ? (
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
                    <CopyDraftButton copied={copied} onCopy={() => void copy()} />
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
            {query.isError ? (
              <div
                role="alert"
                className="mx-5 mt-4 rounded-xl border border-danger-line bg-danger-soft p-4 text-sm text-danger-strong"
              >
                ページを取得できませんでした。
                {hasDraft
                  ? "入力内容はこの画面に残っています。"
                  : "ページが削除されたか、アクセスできません。"}
                <button className="shared-page-text-button" onClick={() => void query.refetch()}>
                  再読み込み
                </button>
              </div>
            ) : null}
            {!editing && !stopped && locked && page?.editing ? (
              <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-line bg-surface-subtle p-3 text-sm leading-6 text-secondary">
                <LockKeyhole size={17} aria-hidden="true" className="mt-1 shrink-0" />
                <p>{page.editing.displayName}が編集中です。保存された内容を表示しています。</p>
              </div>
            ) : null}
            {query.isPending && !newPage ? <PageLoading label="ページを読み込んでいます…" /> : null}
            {hasDraft || page ? (
              <div
                className="shared-page-paper"
                onPointerDown={session.activity}
                onKeyDown={session.activity}
              >
                {hasDraft ? (
                  <input
                    aria-label="タイトル"
                    placeholder="タイトル"
                    maxLength={200}
                    value={state.title}
                    readOnly={!editing || (state.busy && newPage)}
                    onChange={(event) => session.changeTitle(event.target.value)}
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
                <Suspense fallback={<PageLoading label="本文を読み込んでいます…" />}>
                  {hasDraft ? (
                    <DraftEditor
                      key={state.editorKey}
                      session={session}
                      editable={editing && !(state.busy && newPage)}
                      onCompositionChange={setComposing}
                    />
                  ) : (
                    <PageEditor
                      key={page!.version}
                      initialDocument={page!.document}
                      editable={false}
                    />
                  )}
                </Suspense>
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
      <DeleteConfirmModal
        isOpen={deleting}
        isDeleting={state.busy}
        title="このページを削除しますか？"
        message={`「${page?.title ?? ""}」は共有ページの一覧から削除されます。この操作は取り消せません。`}
        onCancel={() => {
          if (!state.busy) setDeleting(false);
        }}
        onConfirm={() => {
          if (!page || state.busy) return;
          void session.remove(page).then((removed) => {
            if (removed) {
              setDeleting(false);
              queryClient.removeQueries({
                queryKey: sharedPageQueryOptions(page.id).queryKey,
                exact: true,
              });
              void queryClient.invalidateQueries({ queryKey: queryKeys.sharedPages, exact: true });
              navigate("/pages", { replace: true });
            } else setDeleting(false);
          });
        }}
      />
      <ConfirmModal
        isOpen={showLeave && copyFallback === null}
        title="保存していない変更があります"
        message={
          state.busy
            ? "通信の結果を確認しています。入力内容を残してお待ちください。"
            : latestRequested
              ? newPage
                ? "変更を破棄して、新しいページを書き直します。"
                : "変更を破棄して、最新の内容を表示します。"
              : "このまま戻ると、変更は保存されません。"
        }
        tone="warning"
        cancelLabel="編集を続ける"
        confirmLabel={
          latestRequested
            ? newPage
              ? "変更を破棄して書き直す"
              : "変更を破棄して最新を表示"
            : "変更を破棄して戻る"
        }
        confirmDisabled={state.busy}
        onCancel={() => {
          setLatestRequested(false);
          blocker.reset?.();
        }}
        onConfirm={() => {
          if (session.getSnapshot().busy) return;
          if (newPage && latestRequested) session.restartNew();
          else session.discard();
          setLatestRequested(false);
          if (blocker.status === "blocked") blocker.proceed();
          else if (!newPage) void query.refetch();
        }}
      >
        {hasDraft ? <CopyDraftButton copied={copied} onCopy={() => void copy()} /> : null}
      </ConfirmModal>
      <FormSheet
        isOpen={copyFallback !== null}
        title="入力内容をコピー"
        submitLabel="入力を選択"
        submitIcon={<Copy size={16} aria-hidden="true" />}
        isSubmitting={false}
        onClose={() => setCopyFallback(null)}
        onSubmit={() => {
          copyInputRef.current?.focus();
          copyInputRef.current?.select();
        }}
      >
        <p className="mb-3 text-sm text-secondary">
          自動コピーが利用できません。本文を選択してコピーしてください。
        </p>
        <textarea
          ref={copyInputRef}
          aria-label="コピーする入力内容"
          className="h-48 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base text-ink"
          readOnly
          value={copyFallback ?? ""}
          onFocus={(event) => event.currentTarget.select()}
        />
      </FormSheet>
    </section>
  );
}

// BlockNote owns the live document. Only a new editing/recovery session
// supplies new initial content; save status and drafts must not feed back into it.
function DraftEditor({
  session,
  editable,
  onCompositionChange,
}: {
  session: PageEditSession;
  editable: boolean;
  onCompositionChange: (composing: boolean) => void;
}) {
  const [initialDocument] = useState(() => session.getSnapshot().draft!.document);
  return (
    <PageEditor
      initialDocument={initialDocument}
      editable={editable}
      onChange={session.changeDocument}
      onCompositionChange={onCompositionChange}
    />
  );
}

function PageLoading({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-8" role="status">
      <LoaderCircle
        size={22}
        className="animate-spin text-muted motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}

function CopyDraftButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  const label = copied ? "入力をコピー済み" : "入力をコピー";
  return (
    <span className="inline-flex">
      <button
        type="button"
        className="shared-page-icon-button border border-line"
        aria-label={label}
        title={label}
        onClick={onCopy}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status">
        {copied ? "入力内容をコピーしました。" : ""}
      </span>
    </span>
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

function PageList({
  detail,
  pageId,
  members,
}: {
  detail: boolean;
  pageId?: string;
  members?: TeamMember[];
}) {
  const list = useQuery({ ...sharedPagesQueryOptions, refetchInterval: 30_000 });
  const membersById = new Map(members?.map((member) => [member.userId, member]));
  return (
    <aside className="shared-pages-list" aria-label="共有ページ一覧">
      {list.isPending ? <PageLoading label="ページを読み込んでいます…" /> : null}
      {list.isError ? (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-danger-line bg-danger-soft p-4 text-sm text-danger-strong"
        >
          一覧を取得できませんでした。
          <button className="shared-page-text-button" onClick={() => void list.refetch()}>
            再読み込み
          </button>
        </div>
      ) : null}
      {list.data?.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong p-4 text-center text-sm text-secondary">
          共有ページはまだありません。
        </p>
      ) : null}
      <div className={detail ? "space-y-1" : "grid gap-3 md:grid-cols-2"}>
        {list.data?.map((item) => (
          <PageListItem
            key={item.id}
            page={item}
            selected={pageId === item.id}
            editorMember={item.editing ? membersById.get(item.editing.userId) : undefined}
          />
        ))}
      </div>
    </aside>
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
          <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-muted px-2 py-1 text-xs text-secondary">
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
