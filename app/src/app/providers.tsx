import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { useEffect, type PropsWithChildren } from "react";

import { appQueryClient } from "../shared/query/queryClient";
import { BootFlowProvider } from "./boot";
import { ThemeSync } from "../shared/state/ThemeSync";

export function AppProviders({ children }: PropsWithChildren) {
  useEffect(() => {
    // TODO専用だった設定を、このブラウザー内の全ユーザー分削除する。
    try {
      const storage = window.localStorage;
      storage.removeItem("kaji:todo-completion-delay-ms:v1");
      storage.removeItem("kaji:legacy-preferences-owner:v1");
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (
          key?.startsWith("kaji:todo-default-category:v1:") ||
          key?.startsWith("kaji:user-preferences:v1:")
        ) {
          storage.removeItem(key);
        }
      }
    } catch {
      // ストレージが無効でも起動する。
    }
  }, []);

  return (
    <BootFlowProvider>
      <JotaiProvider>
        <ThemeSync />
        <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>
      </JotaiProvider>
    </BootFlowProvider>
  );
}
