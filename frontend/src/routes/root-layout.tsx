import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { StatusBanner } from "../components/StatusBanner";
import { LoginCard } from "../features/auth/LoginCard";
import { useMeQuery } from "../features/api/hooks";
import { consumeFlashStatus } from "../lib/auth/flash";
import {
  clearAccessToken,
  readAccessToken,
  writeAccessToken,
} from "../lib/api/client";
import {
  getAuthGoogleStart,
  postAuthLogout,
  postAuthSessionsExchange,
} from "../lib/api/generated/client";
import { formatError } from "../lib/errors";
import { queryKeys } from "../lib/query/queryKeys";
import { isLoggedInAtom, sessionAtom } from "../state/session";
import { statusMessageAtom } from "../state/ui";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-stone-900 text-white" : "bg-stone-100"}`;

export function RootLayout() {
  const queryClient = useQueryClient();
  const [, setSession] = useAtom(sessionAtom);
  const [status, setStatus] = useAtom(statusMessageAtom);
  const loggedIn = useAtomValue(isLoggedInAtom);
  const meQuery = useMeQuery(loggedIn);

  useEffect(() => {
    const token = readAccessToken();
    if (token != null && token !== "") {
      setSession({ token });
    }
  }, [setSession]);

  // Backward compatibility for auth callback style: /?exchangeCode=...
  useEffect(() => {
    const exchangeCode = new URLSearchParams(window.location.search).get(
      "exchangeCode",
    );
    if (exchangeCode == null || exchangeCode === "") {
      return;
    }

    const run = async () => {
      try {
        const res = await postAuthSessionsExchange({ exchangeCode });
        writeAccessToken(res.data.accessToken);
        setSession({ token: res.data.accessToken });
        const next = new URL(window.location.href);
        next.searchParams.delete("exchangeCode");
        window.history.replaceState({}, "", next.pathname + next.search);
        setStatus("ログインしました");
      } catch (error) {
        setStatus(`ログインに失敗しました: ${formatError(error)}`);
      }
    };

    void run();
  }, [setSession, setStatus]);

  useEffect(() => {
    const flash = consumeFlashStatus();
    if (flash != null) {
      setStatus(flash);
    }
  }, [setStatus]);

  const login = async () => {
    try {
      const res = await getAuthGoogleStart();
      window.location.href = res.data.authorizationUrl;
    } catch (error) {
      setStatus(`ログイン開始に失敗しました: ${formatError(error)}`);
    }
  };

  const logout = async () => {
    try {
      await postAuthLogout();
    } catch {
      // ignore logout request errors and clear local session anyway
    }
    clearAccessToken();
    setSession({ token: null });
    setStatus("ログアウトしました");
    await queryClient.removeQueries();
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
              <button type="button" className="rounded-lg border border-stone-300 px-3 py-1 text-sm" onClick={() => void logout()}>
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
            <button type="button" className="ml-auto rounded-lg border border-stone-300 px-3 py-2 text-sm" onClick={() => void refresh()}>
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
