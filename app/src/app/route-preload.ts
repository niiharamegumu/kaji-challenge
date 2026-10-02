import type { QueryClient } from "@tanstack/react-query";
import { prefetchHomeData } from "../features/home/preload";
import { tasksQueryOptions } from "../features/tasks/hooks/useTasks";
import { penaltyRulesQueryOptions } from "../features/penalties/hooks/usePenaltyRules";
import { currentInviteQueryOptions } from "../features/settings/hooks/useSettings";
import {
  reminderCalendarQueryOptions,
  reminderDefinitionsQueryOptions,
} from "../features/reminders/hooks/useReminders";
import { todoCategoriesQueryOptions, todoItemsQueryOptions } from "../shared/query/todoQueries";
import { teamMembersQueryOptions } from "../shared/query/teamMembersQuery";
import {
  monthlyPenaltySummaryQueryOptions,
  penaltyRulesWithDeletedQueryOptions,
} from "../shared/query/monthlyPenaltyQueries";
import { dateStringInJST } from "../shared/utils/dates";

/** ナビゲーション意図の時点で取得する。queryの鮮度・実行中リクエストを共有し、失敗は遷移を妨げない。 */
export async function prefetchRouteData(client: QueryClient, path: string) {
  switch (path) {
    case "/":
      await prefetchHomeData(client);
      break;
    case "/todos":
      await Promise.all([
        client.prefetchQuery(todoItemsQueryOptions),
        client.prefetchQuery(todoCategoriesQueryOptions),
      ]);
      break;
    case "/todo-categories":
      await client.prefetchQuery(todoCategoriesQueryOptions);
      break;
    case "/tasks":
      await client.prefetchQuery(tasksQueryOptions);
      break;
    case "/penalties":
      await client.prefetchQuery(penaltyRulesQueryOptions);
      break;
    case "/settings":
      await Promise.all([
        client.prefetchQuery(teamMembersQueryOptions),
        client.prefetchQuery(currentInviteQueryOptions()),
      ]);
      break;
    case "/summary":
      await Promise.all([
        client.prefetchQuery(monthlyPenaltySummaryQueryOptions(dateStringInJST().slice(0, 7))),
        client.prefetchQuery(penaltyRulesWithDeletedQueryOptions),
      ]);
      break;
    case "/calendar":
      await Promise.all([
        client.prefetchQuery(reminderDefinitionsQueryOptions),
        client.prefetchQuery(reminderCalendarQueryOptions(dateStringInJST().slice(0, 7))),
      ]);
      break;
  }
}
