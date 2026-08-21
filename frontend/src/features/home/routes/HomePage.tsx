import { useAtom } from "jotai";

import { statusMessageAtom } from "../../../shared/state/status";
import { useShoppingItemMutations } from "../../shopping-list";
import { DailyTasksPanel } from "../components/DailyTasksPanel";
import { HomeShoppingListPanel } from "../components/HomeShoppingListPanel";
import { HOME_PANEL_SKELETON_CLASS_NAME } from "../components/panelStyles";
import { TriggeredPenaltiesPanel } from "../components/TriggeredPenaltiesPanel";
import { WeeklyRemindersPanel } from "../components/WeeklyRemindersPanel";
import { WeeklyTasksPanel } from "../components/WeeklyTasksPanel";
import {
  useHomePageQueries,
  useToggleCompletionMutation,
} from "../hooks/useHomeQueries";

export function HomePageSkeleton() {
  return (
    <output
      className="mt-2 space-y-1.5 md:mt-4 md:space-y-3"
      aria-label="ホームを読み込み中"
      aria-live="polite"
    >
      <section className="grid gap-2 md:grid-cols-2 md:gap-4">
        {["daily", "weekly"].map((panel) => (
          <article key={panel} className={HOME_PANEL_SKELETON_CLASS_NAME}>
            <div className="mx-2 h-6 w-28 rounded bg-stone-200 md:mx-0" />
            <div className="mx-2 mt-3 space-y-2 md:mx-0">
              {[0, 1, 2].map((row) => (
                <div
                  key={`${panel}-${row}`}
                  className="rounded-xl border border-stone-100 bg-stone-50 p-3"
                >
                  <div className="h-4 w-2/5 rounded bg-stone-200" />
                  <div className="mt-2 h-3 w-4/5 rounded bg-stone-100" />
                  <div className="mt-3 h-3 w-3/5 rounded bg-stone-100" />
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="grid gap-2 md:grid-cols-2 md:gap-4">
        {["reminders", "shopping"].map((panel) => (
          <article key={panel} className={HOME_PANEL_SKELETON_CLASS_NAME}>
            <div className="mx-2 h-6 w-28 rounded bg-stone-200 md:mx-0" />
            <div className="mx-2 mt-3 space-y-2 md:mx-0">
              {[0, 1, 2].map((row) => (
                <div
                  key={`${panel}-${row}`}
                  className="rounded-xl border border-stone-100 bg-stone-50 p-3"
                >
                  <div className="h-4 w-2/5 rounded bg-stone-200" />
                  <div className="mt-2 h-3 w-4/5 rounded bg-stone-100" />
                  <div className="mt-3 h-3 w-3/5 rounded bg-stone-100" />
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <article className={HOME_PANEL_SKELETON_CLASS_NAME}>
        <div className="mx-2 h-6 w-48 rounded bg-stone-200 md:mx-0" />
        <div className="mx-2 mt-3 grid gap-2 md:mx-0 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1].map((row) => (
            <div
              key={`penalty-${row}`}
              className="h-16 rounded-xl border border-stone-100 bg-stone-50"
            />
          ))}
        </div>
      </article>
    </output>
  );
}

export function HomePage() {
  const [, setStatus] = useAtom(statusMessageAtom);
  const {
    homeQuery,
    shoppingItemsQuery,
    previousMonth,
    previousMonthPenaltySummaryQuery,
    penaltyRulesQuery,
  } = useHomePageQueries();
  const toggleMutation = useToggleCompletionMutation(setStatus);
  const { updateItem, removeItem, reorderItems } =
    useShoppingItemMutations(setStatus);

  const home = homeQuery.data;
  const shoppingItems = shoppingItemsQuery.data;
  const previousMonthPenaltySummary = previousMonthPenaltySummaryQuery.data;

  const weeklyProgress =
    home == null
      ? "0/0"
      : `${home.weeklyTasks.filter((item) => item.weekCompletedCount >= item.requiredCompletionsPerWeek).length}/${home.weeklyTasks.length}`;

  return (
    <div className="mt-2 space-y-1.5 md:mt-4 md:space-y-3">
      <section className="grid gap-2 md:grid-cols-2 md:gap-4">
        <DailyTasksPanel
          items={home.dailyTasks}
          onToggle={(taskId) => {
            void toggleMutation.mutateAsync({ taskId, action: "toggle" });
          }}
        />
        <WeeklyTasksPanel
          items={home.weeklyTasks}
          elapsedDaysInWeek={home.elapsedDaysInWeek}
          weeklyProgress={weeklyProgress}
          onToggle={(taskId) => {
            void toggleMutation.mutateAsync({ taskId, action: "toggle" });
          }}
          onIncrement={(taskId) => {
            void toggleMutation.mutateAsync({ taskId, action: "increment" });
          }}
          onDecrement={(taskId) => {
            void toggleMutation.mutateAsync({ taskId, action: "decrement" });
          }}
        />
      </section>

      <section className="grid gap-2 md:grid-cols-2 md:gap-4">
        <WeeklyRemindersPanel items={home.weeklyReminders} />
        <HomeShoppingListPanel
          items={shoppingItems}
          isReordering={reorderItems.isPending}
          onDelete={(itemId) => {
            void removeItem.mutateAsync(itemId);
          }}
          onReorder={(itemIds) => {
            void reorderItems.mutateAsync({ itemIds });
          }}
          onUpdate={async (itemId, payload) => {
            await updateItem.mutateAsync({ itemId, payload });
          }}
        />
      </section>

      <TriggeredPenaltiesPanel
        triggeredPenaltyRuleIds={
          previousMonthPenaltySummary.triggeredPenaltyRuleIds
        }
        rules={penaltyRulesQuery.data}
        summaryMonth={previousMonth}
      />
    </div>
  );
}
