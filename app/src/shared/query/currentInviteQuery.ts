import { queryOptions } from "@tanstack/react-query";
import { getTeamCurrentInvite } from "../../lib/api/operations";
import { extractHttpStatus } from "../utils/errors";
import { queryKeys } from "./queryKeys";

export function currentInviteQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.currentInvite,
    queryFn: async ({ signal }) => {
      try {
        return (await getTeamCurrentInvite({ signal })).data;
      } catch (error) {
        if (extractHttpStatus(error) === 404) return null;
        throw error;
      }
    },
  });
}
