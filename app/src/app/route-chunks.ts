import { lazy } from "react";

const loadTasksPage = () => import("../features/tasks/routes/TasksPage");
const loadPenaltiesPage = () => import("../features/penalties/routes/PenaltiesPage");
const loadSettingsPage = () => import("../features/settings/routes/SettingsPage");
const loadSummaryPage = () => import("../features/summary/routes/SummaryPage");
const loadReminderCalendarPage = () => import("../features/reminders/routes/ReminderCalendarPage");
const loadShoppingListPage = () => import("../features/shopping-list/routes/ShoppingListPage");

let tasksPagePromise: Promise<typeof import("../features/tasks/routes/TasksPage")> | null = null;
let penaltiesPagePromise: Promise<
  typeof import("../features/penalties/routes/PenaltiesPage")
> | null = null;
let settingsPagePromise: Promise<typeof import("../features/settings/routes/SettingsPage")> | null =
  null;
let summaryPagePromise: Promise<typeof import("../features/summary/routes/SummaryPage")> | null =
  null;
let reminderCalendarPagePromise: Promise<
  typeof import("../features/reminders/routes/ReminderCalendarPage")
> | null = null;
let shoppingListPagePromise: Promise<
  typeof import("../features/shopping-list/routes/ShoppingListPage")
> | null = null;

export function preloadTasksPageChunk() {
  tasksPagePromise ??= loadTasksPage();
  return tasksPagePromise;
}

export function preloadPenaltiesPageChunk() {
  penaltiesPagePromise ??= loadPenaltiesPage();
  return penaltiesPagePromise;
}

export function preloadSettingsPageChunk() {
  settingsPagePromise ??= loadSettingsPage();
  return settingsPagePromise;
}

export function preloadSummaryPageChunk() {
  summaryPagePromise ??= loadSummaryPage();
  return summaryPagePromise;
}

export function preloadReminderCalendarPageChunk() {
  reminderCalendarPagePromise ??= loadReminderCalendarPage();
  return reminderCalendarPagePromise;
}

export function preloadShoppingListPageChunk() {
  shoppingListPagePromise ??= loadShoppingListPage();
  return shoppingListPagePromise;
}

export const TasksPage = lazy(async () => {
  const module = await preloadTasksPageChunk();
  return { default: module.TasksPage };
});

export const PenaltiesPage = lazy(async () => {
  const module = await preloadPenaltiesPageChunk();
  return { default: module.PenaltiesPage };
});

export const SettingsPage = lazy(async () => {
  const module = await preloadSettingsPageChunk();
  return { default: module.SettingsPage };
});

export const SummaryPage = lazy(async () => {
  const module = await preloadSummaryPageChunk();
  return { default: module.SummaryPage };
});

export const ReminderCalendarPage = lazy(async () => {
  const module = await preloadReminderCalendarPageChunk();
  return { default: module.ReminderCalendarPage };
});

export const ShoppingListPage = lazy(async () => {
  const module = await preloadShoppingListPageChunk();
  return { default: module.ShoppingListPage };
});
