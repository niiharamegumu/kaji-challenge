import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import { getTeamCurrentMembers } from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { extractHttpStatus, formatError } from "../../../shared/utils/errors";
import { isLoggedInAtom, sessionAtom } from "../../../state/session";
import {
  initialRuleFormState,
  initialTaskFormState,
  ruleFormAtom,
  taskFormAtom,
} from "../../admin/state/forms";
import { inviteCodeAtom, joinCodeAtom } from "../../admin/state/ui";
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

export function RootLayout() {
  const queryClient = useQueryClient();
  const [, setSession] = useAtom(sessionAtom);
  const [status, setStatus] = useAtom(statusMessageAtom);
  const loggedIn = useAtomValue(isLoggedInAtom);
  const navigate = useNavigate();
  const location = useLocation();
  const [authChecked, setAuthChecked] = useState(false);
  const handledInvalidSessionRef = useRef(false);

  const setTaskForm = useSetAtom(taskFormAtom);
  const setRuleForm = useSetAtom(ruleFormAtom);
  const setInviteCode = useSetAtom(inviteCodeAtom);
  const setJoinCode = useSetAtom(joinCodeAtom);

  const meQuery = useMeQuery(true);
  const currentUserID = meQuery.data?.user.id;
  const teamMembersQuery = useQuery({
    queryKey: queryKeys.teamMembers,
    queryFn: async () => (await getTeamCurrentMembers()).data.items,
    enabled: currentUserID != null,
  });
  const login = useLoginAction(setStatus);
  const logoutAction = useLogoutAction(setStatus, setSession);
  const currentTeamName = meQuery.data?.memberships?.[0]?.teamName ?? "チーム";
  const meMember = teamMembersQuery.data?.find(
    (member) => member.userId === currentUserID,
  );
  const preferredUserName = meMember?.nickname?.trim();
  const currentUserName =
    preferredUserName != null && preferredUserName.length > 0
      ? preferredUserName
      : (meQuery.data?.user.displayName ?? "ログイン中");
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

  useEffect(() => {
    if (!meQuery.isFetching) {
      setAuthChecked(true);
    }
  }, [meQuery.isFetching]);

  useEffect(() => {
    if (meQuery.isSuccess) {
      handledInvalidSessionRef.current = false;
      setSession({ authenticated: true });
      return;
    }
    if (!meQuery.isError) {
      return;
    }

    setSession({ authenticated: false });
    const statusCode = extractHttpStatus(meQuery.error);

    if (statusCode === 401) {
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
    meQuery.isError,
    meQuery.isSuccess,
    navigate,
    queryClient,
    setSession,
    setStatus,
  ]);

  useExchangeCodeFallback(setSession, setStatus);

  useEffect(() => {
    const flash = consumeFlashStatus();
    if (flash != null) {
      setStatus(flash);
    }
  }, [setStatus]);

  const logout = async () => {
    await logoutAction();
    setTaskForm(initialTaskFormState);
    setRuleForm(initialRuleFormState);
    setInviteCode(null);
    setJoinCode("");
  };

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-kohaku-50))] p-6 text-stone-700">
        <p>認証状態を確認中です...</p>
      </main>
    );
  }

  if (!loggedIn) {
    if (location.pathname !== "/") {
      return <Navigate to="/" replace />;
    }
    return <LoginCard status={status} onLogin={() => void login()} />;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-kohaku-50))] p-4 pb-32 text-stone-800 md:p-8 md:pb-20">
      <StatusToast message={status} onDismiss={() => setStatus("")} />

      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-wide">
              {currentTeamName}
            </h1>
            <span className="rounded-full bg-stone-100 px-3 py-2 text-sm text-stone-700">
              {todayLabel}
            </span>
          </div>
        </header>

        <Outlet />
      </div>

      <FloatingNav
        currentUserName={currentUserName}
        onLogout={() => void logout()}
      />
    </main>
  );
}
