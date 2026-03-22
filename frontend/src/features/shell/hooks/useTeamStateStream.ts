import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { queryKeys } from "../../../shared/query/queryKeys";

type UseTeamStateStreamResult = {
  isRefreshing: boolean;
  refreshTeamState: () => Promise<void>;
};

export function useTeamStateStream(
  queryClient: QueryClient,
  isAuthenticated: boolean,
): UseTeamStateStreamResult {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastSeenRevisionRef = useRef(0);
  const pendingEntitiesRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);

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
        queryClient.invalidateQueries({ queryKey: queryKeys.shoppingItems }),
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
    if (pending.has("shopping_item")) {
      operations.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.shoppingItems }),
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

  return { isRefreshing, refreshTeamState };
}
