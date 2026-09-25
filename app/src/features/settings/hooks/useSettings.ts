import { useSuspenseQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getTeamCurrentInvite,
  getTeamCurrentMembers,
  type InviteCodeResponse,
  patchMeColor,
  patchMeNickname,
  patchTeamCurrent,
  postTeamInvite,
  postTeamJoin,
  postTeamLeave,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { extractHttpStatus, formatError } from "../../../shared/utils/errors";
import { INVITE_CODE_EXPIRES_IN_HOURS } from "../constants/invite";

function currentTeamMembersQueryOptions(currentUserId: string | null) {
  return {
    queryKey: [...queryKeys.teamMembers, currentUserId ?? "none"],
    queryFn: async () => {
      if (currentUserId == null) {
        return [];
      }
      return (await getTeamCurrentMembers()).data.items;
    },
  } as const;
}

function currentInviteQueryOptions(currentUserId: string | null) {
  return {
    queryKey: [...queryKeys.currentInvite, currentUserId ?? "none"],
    queryFn: async () => {
      if (currentUserId == null) {
        return null;
      }
      try {
        return (await getTeamCurrentInvite()).data;
      } catch (error) {
        if (extractHttpStatus(error) === 404) {
          return null;
        }
        throw error;
      }
    },
  } as const;
}

export function useTeamSettingsQueries(currentUserId: string | null) {
  const [membersQuery, currentInviteQuery] = useSuspenseQueries({
    queries: [
      currentTeamMembersQueryOptions(currentUserId),
      currentInviteQueryOptions(currentUserId),
    ],
  });

  return { membersQuery, currentInviteQuery };
}

type StatusSetter = (message: string) => void;

const teamMembershipRelatedQueryKeys = [
  queryKeys.me,
  queryKeys.teamMembers,
  queryKeys.home,
  queryKeys.tasks,
  queryKeys.rules,
  queryKeys.monthlySummary,
] as const;

const nicknameRelatedQueryKeys = [queryKeys.teamMembers] as const;

const colorRelatedQueryKeys = [
  queryKeys.teamMembers,
  queryKeys.me,
  queryKeys.home,
  queryKeys.monthlySummary,
] as const;

const teamNameRelatedQueryKeys = [queryKeys.me] as const;

async function invalidateQueryKeys(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKeyList: readonly (readonly string[])[],
) {
  await Promise.all(
    queryKeyList.map((key) =>
      queryClient.invalidateQueries({
        queryKey: key,
      }),
    ),
  );
}

export function useInviteMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const createInvite = useMutation({
    mutationFn: async () => postTeamInvite({ expiresInHours: INVITE_CODE_EXPIRES_IN_HOURS }),
    onSuccess: async (response) => {
      queryClient.setQueriesData<InviteCodeResponse>(
        { queryKey: queryKeys.currentInvite },
        response.data,
      );
    },
    onError: async (error) => {
      setStatus(`招待コード発行に失敗しました: ${formatError(error)}`);
    },
  });

  const joinTeam = useMutation({
    mutationFn: async (code: string) => postTeamJoin({ code }),
    onSuccess: async () => {
      setStatus("チーム参加に成功しました");
      await Promise.all([
        invalidateQueryKeys(queryClient, teamMembershipRelatedQueryKeys),
        queryClient.invalidateQueries({
          queryKey: queryKeys.currentInvite,
        }),
      ]);
    },
    onError: async (error) => {
      if (extractHttpStatus(error) === 409) {
        setStatus("すでに参加しています");
        return;
      }
      setStatus(`チーム参加に失敗しました: ${formatError(error)}`);
    },
  });

  const leaveTeam = useMutation({
    mutationFn: async () => postTeamLeave(),
    onSuccess: async () => {
      setStatus("新しい自分のチームを作成しました");
      await Promise.all([
        invalidateQueryKeys(queryClient, teamMembershipRelatedQueryKeys),
        queryClient.invalidateQueries({
          queryKey: queryKeys.currentInvite,
        }),
      ]);
    },
    onError: async (error) => {
      setStatus(`チーム離脱に失敗しました: ${formatError(error)}`);
    },
  });

  return { createInvite, joinTeam, leaveTeam };
}

export function useProfileMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const updateNickname = useMutation({
    mutationFn: async (nickname: string) => patchMeNickname({ nickname }),
    onSuccess: async (_, nickname) => {
      const message =
        nickname.trim().length === 0
          ? "ニックネームをリセットしました"
          : "ニックネームを更新しました";
      setStatus(message);
      await invalidateQueryKeys(queryClient, nicknameRelatedQueryKeys);
    },
    onError: async (error) => {
      setStatus(`ニックネーム更新に失敗しました: ${formatError(error)}`);
    },
  });

  const updateColor = useMutation({
    mutationFn: async (colorHex: string | null) => patchMeColor({ colorHex }),
    onSuccess: async (_, colorHex) => {
      const message =
        colorHex == null ? "表示カラーをリセットしました" : "表示カラーを更新しました";
      setStatus(message);
      await invalidateQueryKeys(queryClient, colorRelatedQueryKeys);
    },
    onError: async (error) => {
      setStatus(`表示カラー更新に失敗しました: ${formatError(error)}`);
    },
  });

  const updateTeamName = useMutation({
    mutationFn: async (name: string) => patchTeamCurrent({ name }),
    onSuccess: async () => {
      setStatus("チーム名を更新しました");
      await invalidateQueryKeys(queryClient, teamNameRelatedQueryKeys);
    },
    onError: async (error) => {
      setStatus(`チーム名更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { updateNickname, updateColor, updateTeamName };
}
