import { useEffect, useRef } from "react";

import { writeAccessToken } from "../../../lib/api/client";
import { postAuthSessionsExchange } from "../../../lib/api/generated/client";
import { formatError } from "../../../shared/utils/errors";
import type { SessionState } from "../../../state/session";

type StatusSetter = (message: string) => void;
type SessionSetter = (value: SessionState) => void;

export function useExchangeCodeFallback(
  setSession: SessionSetter,
  setStatus: StatusSetter,
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
        const res = await postAuthSessionsExchange({ exchangeCode });
        writeAccessToken(res.data.accessToken);
        setSession({ token: res.data.accessToken });
        setStatus("ログインしました");
      } catch (error) {
        setStatus(`ログインに失敗しました: ${formatError(error)}`);
      }
    };

    void run();
  }, [setSession, setStatus]);
}
