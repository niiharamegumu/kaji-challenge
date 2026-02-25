import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import { getTeamCurrentMembers } from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { extractHttpStatus, formatError } from "../../../shared/utils/errors";
import { isLoggedInAtom, sessionAtom } from "../../../state/session";
import { LoginCard } from "../../auth/components/LoginCard";
import {
  useLoginAction,
  useLogoutAction,
  useMeQuery,
} from "../../auth/hooks/useAuthActions";
import { useExchangeCodeFallback } from "../../auth/hooks/useExchangeCodeFallback";
import { consumeFlashStatus } from "../../auth/state/flash";
import { FloatingNav } from "../components/FloatingNav";
import { StatusToast } from "../components/StatusToast";
import { statusMessageAtom } from "../state/status";

const protectedQueryKeys = [
  queryKeys.me,
  queryKeys.teamMembers,
  queryKeys.currentInvite,
  queryKeys.home,
  queryKeys.tasks,
  queryKeys.rules,
  queryKeys.monthlySummary,
] as const;

export type RootLayoutOutletContext = {
  currentUserId: string | null;
  currentTeamName: string;
  displayName: string;
};

export function RootLayout() {
  const queryClient = useQueryClient();
  const [, setSession] = useAtom(sessionAtom);
  const [status, setStatus] = useAtom(statusMessageAtom);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const loggedIn = useAtomValue(isLoggedInAtom);
  const navigate = useNavigate();
  const location = useLocation();
  const handledInvalidSessionRef = useRef(false);
  const hasValidatedSessionRef = useRef(false);
  const retriedAfterLoginRef = useRef(false);
  const lastSeenRevisionRef = useRef(0);
  const pendingEntitiesRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);

  const meQuery = useMeQuery(true);
  const currentUserID = meQuery.data?.user.id ?? null;
  const cachedMembersQuery = useQuery({
    queryKey: queryKeys.teamMembers,
    queryFn: async () => (await getTeamCurrentMembers()).data.items,
    enabled: false,
  });
  const login = useLoginAction(setStatus);
  const logoutAction = useLogoutAction(setStatus, setSession);
  const currentTeamName = meQuery.data?.memberships?.[0]?.teamName ?? "チーム";
  const preferredNickname =
    cachedMembersQuery.data
      ?.find((member) => member.userId === currentUserID)
      ?.nickname?.trim() ?? "";
  const currentUserName =
    preferredNickname.length > 0
      ? preferredNickname
      : (meQuery.data?.user.displayName ?? "ログイン中");
  const outletContext = useMemo<RootLayoutOutletContext>(
    () => ({
      currentUserId: currentUserID,
      currentTeamName,
      displayName: currentUserName,
    }),
    [currentTeamName, currentUserID, currentUserName],
  );
  const todayLabel = useMemo(() => {
    const now = new Date();
    const fullDate = new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
    const weekday = new Intl.DateTimeFormat("ja-JP", {
      weekday: "short",
    }).format(now);
    return `${fullDate}（${weekday}）`;
  }, []);
  const refetchAfterLogin = useCallback(() => {
    if (retriedAfterLoginRef.current || loggedIn) {
      return;
    }
    retriedAfterLoginRef.current = true;
    void meQuery.refetch();
  }, [loggedIn, meQuery]);

  useEffect(() => {
    if (!loggedIn) {
      hasValidatedSessionRef.current = false;
      retriedAfterLoginRef.current = false;
    }
  }, [loggedIn]);

  useEffect(() => {
    if (meQuery.isSuccess) {
      handledInvalidSessionRef.current = false;
      hasValidatedSessionRef.current = true;
      retriedAfterLoginRef.current = false;
      setSession({ authenticated: true });
      return;
    }
    if (!meQuery.isError) {
      return;
    }

    setSession({ authenticated: false });
    const statusCode = extractHttpStatus(meQuery.error);

    if (statusCode === 401) {
      if (!hasValidatedSessionRef.current) {
        handledInvalidSessionRef.current = false;
        return;
      }
      if (!loggedIn && meQuery.data == null) {
        handledInvalidSessionRef.current = false;
        return;
      }
      if (handledInvalidSessionRef.current) {
        return;
      }
      handledInvalidSessionRef.current = true;

      for (const key of protectedQueryKeys) {
        queryClient.removeQueries({ queryKey: key });
      }
      setStatus(
        "アカウント情報が無効になったため、トップページへ戻りました。再ログインしてください。",
      );
      if (location.pathname !== "/") {
        navigate("/", { replace: true });
      }
      return;
    }

    setStatus(
      `ユーザー情報の取得に失敗しました: ${formatError(meQuery.error)}`,
    );
  }, [
    location.pathname,
    meQuery.error,
    meQuery.data,
    meQuery.isError,
    meQuery.isSuccess,
    loggedIn,
    navigate,
    queryClient,
    setSession,
    setStatus,
  ]);

  useExchangeCodeFallback(setSession, setStatus, refetchAfterLogin);

  useEffect(() => {
    const flash = consumeFlashStatus();
    if (flash != null) {
      setStatus(flash.message);
      if (flash.kind === "login_success") {
        refetchAfterLogin();
      }
    }
  }, [refetchAfterLogin, setStatus]);

  const onDismissStatus = useCallback(() => {
    setStatus("");
  }, [setStatus]);

  const onLogin = useCallback(() => {
    void login();
  }, [login]);

  const onLogout = useCallback(() => {
    void logoutAction();
  }, [logoutAction]);
  const isAuthChecking =
    meQuery.status === "pending" && meQuery.data == null && !meQuery.isError;
  const isAuthenticated = loggedIn || meQuery.isSuccess || meQuery.data != null;

  const refreshTeamState = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.currentInvite }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  const flushPendingEntityInvalidations = useCallback(async () => {
    const pending = pendingEntitiesRef.current;
    if (pending.size === 0) {
      return;
    }
    pendingEntitiesRef.current = new Set();
    if (pending.has("close_run") || pending.has("unknown")) {
      await refreshTeamState();
      return;
    }
    const operations: Promise<unknown>[] = [];
    if (pending.has("task") || pending.has("task_completion")) {
      operations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      );
    }
    if (pending.has("penalty_rule")) {
      operations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      );
    }
    if (
      pending.has("invite") ||
      pending.has("team_member") ||
      pending.has("team_state")
    ) {
      operations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.currentInvite }),
      );
    }
    if (operations.length === 0) {
      await refreshTeamState();
      return;
    }
    await Promise.all(operations);
  }, [queryClient, refreshTeamState]);

  useEffect(() => {
    if (!isAuthenticated) {
      lastSeenRevisionRef.current = 0;
      return;
    }
    if (typeof window === "undefined" || !("EventSource" in window)) {
      return;
    }

    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";
    const streamUrl = `${baseUrl}/v1/events/stream`;
    let disposed = false;
    let retryTimer: number | null = null;
    let retryDelay = 1000;
    let source: EventSource | null = null;

    const resetSource = () => {
      if (source != null) {
        source.close();
        source = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer != null) {
        return;
      }
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    };

    const scheduleEntityFlush = () => {
      if (flushTimerRef.current != null) {
        return;
      }
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        void flushPendingEntityInvalidations();
      }, 300);
    };

    const handleRevision = (revision: number, entity: string) => {
      if (!Number.isFinite(revision) || revision <= 0) {
        return;
      }
      const previous = lastSeenRevisionRef.current;
      if (revision <= previous) {
        return;
      }
      lastSeenRevisionRef.current = revision;
      if (previous > 0 && revision > previous + 1) {
        pendingEntitiesRef.current = new Set();
        void refreshTeamState();
        return;
      }
      const normalized = entity.trim();
      if (normalized === "") {
        pendingEntitiesRef.current.add("unknown");
      } else {
        pendingEntitiesRef.current.add(normalized);
      }
      scheduleEntityFlush();
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      resetSource();
      source = new EventSource(streamUrl, { withCredentials: true });
      source.addEventListener("connected", (event) => {
        retryDelay = 1000;
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            revision?: number;
          };
          if (typeof payload.revision === "number") {
            lastSeenRevisionRef.current = payload.revision;
          }
        } catch {
          // ignore malformed payloads
        }
      });
      source.addEventListener("team-state-changed", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            revision?: number;
            entity?: string;
          };
          if (
            typeof payload.revision === "number" &&
            typeof payload.entity === "string"
          ) {
            handleRevision(payload.revision, payload.entity);
          }
        } catch {
          // ignore malformed payloads
        }
      });
      source.onerror = () => {
        resetSource();
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingEntitiesRef.current = new Set();
      resetSource();
    };
  }, [flushPendingEntityInvalidations, isAuthenticated, refreshTeamState]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    const onOnline = () => {
      void refreshTeamState();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshTeamState();
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isAuthenticated, refreshTeamState]);

  if (isAuthChecking) {
    return (
      <main className="ios-safe-main min-h-screen bg-[color:var(--color-washi-50)] px-2 py-3 text-stone-700 md:p-6">
        <div className="flex justify-center">
          <LoaderCircle
            size={24}
            className="text-stone-500 animate-spin motion-reduce:animate-none"
            aria-label="読み込み中"
            role="status"
          />
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    if (location.pathname !== "/") {
      return <Navigate to="/" replace />;
    }
    return <LoginCard status={status} onLogin={onLogin} />;
  }

  return (
    <main className="ios-safe-main min-h-screen bg-[color:var(--color-washi-50)] px-2 py-2.5 pb-28 text-stone-800 md:p-8 md:pb-20">
      <StatusToast message={status} onDismiss={onDismissStatus} />

      <div className="mx-auto max-w-6xl">
        <header className="rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm backdrop-blur md:rounded-2xl md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 md:gap-3">
            <h1 className="text-xl font-semibold tracking-normal md:text-2xl md:font-bold md:tracking-wide">
              {currentTeamName}
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-xs whitespace-nowrap text-stone-700 md:text-sm">
                {todayLabel}
              </span>
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-stone-700 transition-colors hover:bg-stone-50"
                onClick={() => {
                  void refreshTeamState();
                }}
                disabled={isRefreshing}
                aria-label="最新状態に更新"
              >
                <RefreshCw
                  size={14}
                  className={isRefreshing ? "animate-spin" : ""}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </header>

        <Outlet context={outletContext} />
      </div>

      <FloatingNav currentUserName={currentUserName} onLogout={onLogout} />
    </main>
  );
}
