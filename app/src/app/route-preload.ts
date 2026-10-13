import type { QueryClient } from "@tanstack/react-query";
import { prefetchHomeData } from "../features/home/preload";
import { todoCategoriesQueryOptions, todoItemsQueryOptions } from "../shared/query/todoQueries";
import { teamMembersQueryOptions } from "../shared/query/teamMembersQuery";
import { queryKeys } from "../shared/query/queryKeys";
import {
  monthlyPenaltySummaryQueryOptions,
  penaltyRulesWithDeletedQueryOptions,
} from "../shared/query/monthlyPenaltyQueries";
import { dateStringInJST } from "../shared/utils/dates";

/** ナビゲーション意図の時点で取得する。queryの鮮度・実行中リクエストを共有し、失敗は遷移を妨げない。 */
export async function prefetchRouteData(client: QueryClient, path: string) {
  // コードの取得待ちにログアウト・所属変更が起きたら、新しい通信を開始しない。
  const me = client.getQueryData(queryKeys.me);
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
    case "/tasks": {
      const { tasksQueryOptions } = await import("../features/tasks/hooks/useTasks");
      if (client.getQueryData(queryKeys.me) !== me) return;
      await client.prefetchQuery(tasksQueryOptions);
      break;
    }
    case "/penalties": {
      const { penaltyRulesQueryOptions } =
        await import("../features/penalties/hooks/usePenaltyRules");
      if (client.getQueryData(queryKeys.me) !== me) return;
      await client.prefetchQuery(penaltyRulesQueryOptions);
      break;
    }
    case "/settings": {
      const { currentInviteQueryOptions } = await import("../features/settings/hooks/useSettings");
      if (client.getQueryData(queryKeys.me) !== me) return;
      await Promise.all([
        client.prefetchQuery(teamMembersQueryOptions),
        client.prefetchQuery(currentInviteQueryOptions()),
      ]);
      break;
    }
    case "/summary":
      await Promise.all([
        client.prefetchQuery(monthlyPenaltySummaryQueryOptions(dateStringInJST().slice(0, 7))),
        client.prefetchQuery(penaltyRulesWithDeletedQueryOptions),
      ]);
      break;
    case "/calendar": {
      const { reminderDefinitionsQueryOptions, reminderCalendarQueryOptions } =
        await import("../features/reminders/hooks/useReminders");
      if (client.getQueryData(queryKeys.me) !== me) return;
      await Promise.all([
        client.prefetchQuery(reminderDefinitionsQueryOptions),
        client.prefetchQuery(reminderCalendarQueryOptions(dateStringInJST().slice(0, 7))),
      ]);
      break;
    }
  }
}
