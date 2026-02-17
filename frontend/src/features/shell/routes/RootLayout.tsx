import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { queryKeys } from "../../../shared/query/queryKeys";
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
import { StatusBanner } from "../components/StatusBanner";
import { statusMessageAtom } from "../state/status";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-stone-900 text-white" : "bg-stone-100"}`;

export function RootLayout() {
  const queryClient = useQueryClient();
  const [, setSession] = useAtom(sessionAtom);
  const [status, setStatus] = useAtom(statusMessageAtom);
  const loggedIn = useAtomValue(isLoggedInAtom);

  const setTaskForm = useSetAtom(taskFormAtom);
  const setRuleForm = useSetAtom(ruleFormAtom);
  const setInviteCode = useSetAtom(inviteCodeAtom);
  const setJoinCode = useSetAtom(joinCodeAtom);

  const meQuery = useMeQuery(true);
  const login = useLoginAction(setStatus);
  const logoutAction = useLogoutAction(setStatus, setSession);

  useEffect(() => {
    if (meQuery.isSuccess) {
      setSession({ authenticated: true });
      return;
    }
    if (meQuery.isError) {
      setSession({ authenticated: false });
    }
  }, [meQuery.isError, meQuery.isSuccess, setSession]);

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

  if (!loggedIn) {
    return <LoginCard status={status} onLogin={() => void login()} />;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-kohaku-50))] p-4 text-stone-800 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl border border-[color:var(--color-matcha-300)] bg-white/90 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-wide">家事チャレ</h1>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[color:var(--color-matcha-100)] px-3 py-1 text-sm">
                {meQuery.data?.user.displayName ?? "ログイン中"}
              </span>
              <button
                type="button"
                className="rounded-lg border border-stone-300 px-3 py-1 text-sm"
                onClick={() => void logout()}
              >
                ログアウト
              </button>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <NavLink className={linkClass} to="/" end>
              ホーム
            </NavLink>
            <NavLink className={linkClass} to="/admin">
              管理
            </NavLink>
            <button
              type="button"
              className="ml-auto rounded-lg border border-stone-300 px-3 py-2 text-sm"
              onClick={() => void refresh()}
            >
              再読込
            </button>
          </div>
          <StatusBanner message={status} />
        </header>

        <Outlet />
      </div>
    </main>
  );
}
