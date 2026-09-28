import { queryOptions } from "@tanstack/react-query";
import { getTeamCurrentMembers } from "../../lib/api/operations";
import { queryKeys } from "./queryKeys";

export const teamMembersQueryOptions = queryOptions({
  queryKey: queryKeys.teamMembers,
  queryFn: async ({ signal }) => (await getTeamCurrentMembers({ signal })).data.items,
});
