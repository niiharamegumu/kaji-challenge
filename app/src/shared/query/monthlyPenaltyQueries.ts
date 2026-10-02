import { queryOptions } from "@tanstack/react-query";

import { getPenaltySummaryMonthly, listPenaltyRules } from "../../lib/api/operations";
import { queryKeys } from "./queryKeys";

export const monthlyPenaltySummaryQueryOptions = (month: string) =>
  queryOptions({
    queryKey: [...queryKeys.monthlySummary, month],
    queryFn: async ({ signal }) => (await getPenaltySummaryMonthly({ month }, { signal })).data,
  });

export const penaltyRulesWithDeletedQueryOptions = queryOptions({
  queryKey: [...queryKeys.rules, "withDeleted"],
  queryFn: async ({ signal }) =>
    (await listPenaltyRules({ includeDeleted: true }, { signal })).data.items,
});
