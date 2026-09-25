import { useEffect, useState } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { realtimeMessageSchema } from "../../../contracts/realtime";
import {
  refreshTeamState,
  teamStateRefreshQueryKeys,
} from "../../../shared/query/teamStateRefresh";
import { queryKeys } from "../../../shared/query/queryKeys";
import { cancelTeamRequests } from "../../../lib/api/serverClient";

type ConnectionState = {
  teamId: string;
  userId: string;
  userIds: string[];
  connected: boolean;
};

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/** 共通レイアウトで、所属チームへの接続と通知に応じたデータ再取得を管理する。 */
export function useTeamRealtime(teamId: string | undefined, userId: string | null) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState | null>(null);

  useEffect(() => {
    if (!teamId || !userId) return;
    return startTeamRealtime({ teamId, userId, queryClient, onStateChange: setState });
  }, [teamId, userId, queryClient]);

  // Effectの切り替え前のrenderでも、旧チーム・旧ユーザーの一覧を表示しない。
  return state && state.teamId === teamId && state.userId === userId
    ? state
    : { userIds: [], connected: false };
}

type TeamRealtimeOptions = {
  teamId: string;
  userId: string;
  queryClient: QueryClient;
  onStateChange: (state: ConnectionState | null) => void;
};

/** 接続と購読を開始し、タイマー・通信・キャッシュを片付ける終了関数を返す。 */
function startTeamRealtime({
  teamId,
  userId,
  queryClient,
  onStateChange,
}: TeamRealtimeOptions): () => void {
  const identity = { teamId, userId };

  // この呼び出しの接続だけに属する値。チーム・ユーザーの変更時に作り直す。
  let disposed = false;
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  let refreshPending = false;

  // 再取得：保存中の楽観表示を守り、複数の通知は保存終了後の1回にまとめる。
  function flushPendingRefresh() {
    if (disposed || !refreshPending || queryClient.isMutating() > 0) return;

    refreshPending = false;
    void refreshTeamState(queryClient);
  }

  function requestRefresh() {
    if (disposed) return;
    refreshPending = true;
    flushPendingRefresh();
  }

  // 受信：接続メンバー一覧は置き換え、業務データの変更はAPIで読み直す。
  function handleMessage(event: MessageEvent) {
    if (disposed) return;

    let raw: unknown;
    try {
      raw = JSON.parse(event.data);
    } catch {
      return;
    }
    const result = realtimeMessageSchema.safeParse(raw);
    if (!result.success) return;

    switch (result.data.type) {
      case "presence":
        onStateChange({ ...identity, userIds: result.data.userIds, connected: true });
        break;
      case "team-changed":
        requestRefresh();
        break;
    }
  }

  function handleOpen() {
    if (disposed) return;
    reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    requestRefresh();
  }

  function handleClose(event: CloseEvent) {
    if (disposed) return;
    onStateChange({ ...identity, userIds: [], connected: false });

    // 1008はセッション・所属などの拒否。タイマーで再接続せず本人情報を確認する。
    if (event.code === 1008) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      return;
    }

    // 通常の切断では接続だけを1、2、4…最大30秒間隔で再試行する。保存は再送しない。
    reconnectTimer = setTimeout(connect, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }

  function connect() {
    const hasActiveConnection =
      socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING;
    if (disposed || hasActiveConnection) return;

    const url = new URL("/api/realtime", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const connection = new WebSocket(url);
    socket = connection;
    connection.onopen = handleOpen;
    connection.onmessage = handleMessage;
    connection.onclose = handleClose;
    connection.onerror = () => connection.close();
  }

  // アプリ・回線の復帰時は待ち時間を解除し、通知を取りこぼした状態も読み直す。
  function handleResume() {
    if (document.visibilityState === "hidden") return;
    requestRefresh();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    connect();
  }

  const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
    // 応答を失った保存も、自動再送せず最新データで確認する。
    if (event.type === "updated" && event.action.type === "error") requestRefresh();
    else flushPendingRefresh();
  });

  // 開始：ページ移動では作り直さず、所属・ユーザーが変わった場合だけ接続を切り替える。
  connect();
  window.addEventListener("online", handleResume);
  window.addEventListener("pageshow", handleResume);
  document.addEventListener("visibilitychange", handleResume);

  // 終了：古い接続の通知・通信・キャッシュを次の所属へ持ち越さない。
  return () => {
    disposed = true;
    onStateChange(null);
    cancelTeamRequests();
    unsubscribeMutations();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close(1000, "Leaving team");
    window.removeEventListener("online", handleResume);
    window.removeEventListener("pageshow", handleResume);
    document.removeEventListener("visibilitychange", handleResume);
    for (const queryKey of teamStateRefreshQueryKeys) {
      if (queryKey === queryKeys.me) continue;
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
    }
  };
}
