import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useSetAtom } from "jotai";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

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
  const login = useLoginAction(setStatus);
  const logoutAction = useLogoutAction(setStatus, setSession);

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
    setInviteCode("");
    setJoinCode("");
  };

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
      queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
    ]);
    setStatus("最新状態に同期しました");
  };

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-matcha-50))] p-6 text-stone-700">
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
        <header className="rounded-2xl border border-[color:var(--color-matcha-300)] bg-white/90 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-wide">KajiChalle</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 transition-colors duration-200 hover:bg-stone-50"
                onClick={() => void refresh()}
                aria-label="最新状態に再読込する"
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>再読込</span>
              </button>
              <span className="rounded-full bg-[color:var(--color-matcha-100)] px-3 py-2 text-sm">
                {meQuery.data?.user.displayName ?? "ログイン中"}
              </span>
            </div>
          </div>
        </header>

        <Outlet />
      </div>

      <FloatingNav onLogout={() => void logout()} />
    </main>
  );
}
