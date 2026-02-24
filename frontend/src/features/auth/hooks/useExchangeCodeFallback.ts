import { useEffect, useRef } from "react";

import { postAuthSessionsExchange } from "../../../lib/api/generated/client";
import { formatError } from "../../../shared/utils/errors";
import type { SessionState } from "../../../state/session";

type StatusSetter = (message: string) => void;
type SessionSetter = (value: SessionState) => void;

export function useExchangeCodeFallback(
  setSession: SessionSetter,
  setStatus: StatusSetter,
  onLoginSuccess: () => void,
) {
  const processedRef = useRef<string | null>(null);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const exchangeCode = currentUrl.searchParams.get("exchangeCode");
    if (exchangeCode == null || exchangeCode === "") {
      return;
    }

    if (processedRef.current === exchangeCode) {
      return;
    }
    processedRef.current = exchangeCode;

    // Remove query immediately to avoid duplicate submission on StrictMode remounts.
    currentUrl.searchParams.delete("exchangeCode");
    window.history.replaceState(
      {},
      "",
      currentUrl.pathname + currentUrl.search,
    );

    const run = async () => {
      try {
        await postAuthSessionsExchange({ exchangeCode });
        setSession({ authenticated: true });
        setStatus("ログインしました");
        onLoginSuccess();
      } catch (error) {
        setStatus(`ログインに失敗しました: ${formatError(error)}`);
      }
    };

    void run();
  }, [onLoginSuccess, setSession, setStatus]);
}
