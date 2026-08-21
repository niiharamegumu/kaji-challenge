import { queryOptions } from "@tanstack/react-query";

import {
  getPenaltySummaryMonthly,
  listPenaltyRules,
} from "../../lib/api/generated/client";
import { queryKeys } from "./queryKeys";

export const monthlyPenaltySummaryQueryOptions = (month: string) =>
  queryOptions({
    queryKey: [...queryKeys.monthlySummary, month],
    queryFn: async () => (await getPenaltySummaryMonthly({ month })).data,
  });

export const penaltyRulesWithDeletedQueryOptions = queryOptions({
  queryKey: [...queryKeys.rules, "withDeleted"],
  queryFn: async () =>
    (await listPenaltyRules({ includeDeleted: true })).data.items,
});
