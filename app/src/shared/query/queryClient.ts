import { QueryClient } from "@tanstack/react-query";

export const appQueryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      // 更新はオフラインでも一度試行し、失敗を返す。再ログイン後へ自動送信を持ち越さない。
      networkMode: "always",
      retry: false,
    },
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});
