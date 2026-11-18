import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { atom, useAtomValue, useSetAtom } from "jotai";
import {
  getMePreferences,
  initializeMePreferences,
  patchMePreferences,
} from "../../lib/api/operations";
import {
  defaultUserPreferences,
  type UserPreferences,
  type UpdateUserPreferences,
} from "../../contracts/user-preferences";
import { activeUserPreferencesAtom, UserPreferencesContext } from "../state/userPreferences";
import { statusMessageAtom } from "../state/status";
import {
  readLegacyUserPreferences,
  readUserPreferencesCache,
  userPreferencesStorageKey,
  writeUserPreferencesCache,
} from "../state/userPreferencesCache";
import { queryKeys } from "./queryKeys";

type Command =
  | { kind: "initialize"; values: UserPreferences }
  | { kind: "patch"; values: UpdateUserPreferences };

export function UserPreferencesProvider({
  userId,
  teamId,
  children,
}: {
  userId: string;
  teamId: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const queryKey = [...queryKeys.userPreferences, userId];
  const setActivePreferences = useSetAtom(activeUserPreferencesAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const localAtom = useMemo(() => {
    const value = atom<{ cached: UserPreferences | null; initial: UserPreferences } | null>(null);
    // Storage is an external source: subscribe after mount, never during SSR/hydration.
    value.onMount = (setValue) =>
      setValue({
        cached: readUserPreferencesCache(userId),
        initial: readLegacyUserPreferences(userId, teamId),
      });
    return value;
  }, [userId, teamId]);
  const local = useAtomValue(localAtom);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);

  const save = useMutation({
    mutationKey: [...queryKeys.userPreferences, userId],
    networkMode: "always",
    retry: false,
    mutationFn: async (command: Command) => {
      const signal = controller.current!.signal;
      await queryClient.cancelQueries({ queryKey });
      signal.throwIfAborted();
      const result =
        command.kind === "initialize"
          ? await initializeMePreferences(command.values, { signal })
          : await patchMePreferences(command.values, { signal });
      signal.throwIfAborted();
      return result.data;
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(queryKey, preferences);
    },
    onError: (_error, command) => {
      if (controller.current?.signal.aborted || command.kind !== "patch") return;
      setStatus("設定を保存できませんでした。もう一度変更してください。");
      void queryClient.invalidateQueries({ queryKey });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => (await getMePreferences({ signal })).data,
    enabled: local !== null && !save.isPending,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  useEffect(() => {
    controller.current = new AbortController();
    const requestController = controller.current;
    return () => {
      requestController.abort();
      setActivePreferences(null);
    };
  }, [userId, teamId, setActivePreferences]);

  const { mutate, status } = save;
  useEffect(() => {
    if (query.data !== null || local === null || status !== "idle" || submitting.current) return;
    submitting.current = true;
    mutate({ kind: "initialize", values: local.cached ?? local.initial });
  }, [query.data, local, status, mutate]);

  const confirmed = query.data ?? local?.cached;
  const preferences = useMemo(
    () =>
      save.isPending && save.variables.kind === "patch"
        ? { ...(confirmed ?? defaultUserPreferences), ...save.variables.values }
        : (confirmed ?? local?.initial ?? defaultUserPreferences),
    [save.isPending, save.variables, confirmed, local?.initial],
  );
  const ready = confirmed != null;

  useEffect(() => {
    if (local !== null) setActivePreferences(preferences);
  }, [local, preferences, setActivePreferences]);
  useEffect(() => {
    if (query.data) writeUserPreferencesCache(userId, query.data);
  }, [userId, query.data]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== userPreferencesStorageKey(userId) && event.key !== null) return;
      // Storage is only a cache; another tab's update/clear asks D1 for the latest value.
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.userPreferences, userId] });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId, queryClient]);

  return (
    <UserPreferencesContext
      value={{
        preferences,
        ready,
        writable: query.data != null && !save.isPending,
        saving: save.isPending,
        error:
          save.isError && save.variables.kind === "initialize"
            ? "設定を保存できませんでした。再取得してから、もう一度変更してください。"
            : query.isError
              ? "設定を取得できませんでした。接続を確認して再取得してください。"
              : null,
        update: (patch) => {
          if (query.data == null || submitting.current || save.isPending) return;
          submitting.current = true;
          save.mutate({ kind: "patch", values: patch });
        },
        refresh: () => {
          save.reset();
          void query.refetch();
        },
      }}
    >
      {children}
    </UserPreferencesContext>
  );
}
