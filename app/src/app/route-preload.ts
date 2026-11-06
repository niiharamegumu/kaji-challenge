import type { QueryClient } from "@tanstack/react-query";
import { prefetchHomeData } from "../features/home/preload";
import { todoCategoriesQueryOptions, todoItemsQueryOptions } from "../shared/query/todoQueries";
import { teamMembersQueryOptions } from "../shared/query/teamMembersQuery";
import { tasksQueryOptions } from "../shared/query/taskQueries";
import { sharedPagesQueryOptions, sharedPageQueryOptions } from "../shared/query/sharedPageQueries";
import { currentInviteQueryOptions } from "../shared/query/currentInviteQuery";
import {
  reminderCalendarQueryOptions,
  reminderDefinitionsQueryOptions,
} from "../shared/query/reminderQueries";
import {
  monthlyPenaltySummaryQueryOptions,
  penaltyRulesQueryOptions,
  penaltyRulesWithDeletedQueryOptions,
} from "../shared/query/monthlyPenaltyQueries";
import { resolveCalendarDate, resolveSummaryMonth } from "../shared/router/dateParams";
import { dateStringInJST } from "../shared/utils/dates";

/** ナビゲーション意図の時点で取得する。queryの鮮度・実行中リクエストを共有し、失敗は遷移を妨げない。 */
export async function prefetchRouteData(client: QueryClient, destination: string) {
  const url = new URL(destination, "https://kaji.invalid");
  const today = dateStringInJST();
  if (url.pathname.startsWith("/pages/")) {
    const pageId = url.pathname.slice("/pages/".length);
    await Promise.all([
      client.prefetchQuery(sharedPagesQueryOptions),
      pageId !== "new" && pageId !== ""
        ? client.prefetchQuery(sharedPageQueryOptions(pageId))
        : Promise.resolve(),
    ]);
    return;
  }
  switch (url.pathname) {
    case "/pages":
      await client.prefetchQuery(sharedPagesQueryOptions);
      break;
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
      await client.prefetchQuery(tasksQueryOptions);
      break;
    }
    case "/penalties": {
      await client.prefetchQuery(penaltyRulesQueryOptions);
      break;
    }
    case "/settings": {
      await Promise.all([
        client.prefetchQuery(teamMembersQueryOptions),
        client.prefetchQuery(currentInviteQueryOptions()),
      ]);
      break;
    }
    case "/summary": {
      const month = resolveSummaryMonth(url.searchParams.get("month"), today);
      await Promise.all([
        client.prefetchQuery(monthlyPenaltySummaryQueryOptions(month)),
        client.prefetchQuery(penaltyRulesWithDeletedQueryOptions),
      ]);
      break;
    }
    case "/calendar": {
      const month = resolveCalendarDate(url.searchParams.get("date"), today).slice(0, 7);
      await Promise.all([
        client.prefetchQuery(reminderDefinitionsQueryOptions),
        client.prefetchQuery(reminderCalendarQueryOptions(month)),
      ]);
      break;
    }
  }
}
