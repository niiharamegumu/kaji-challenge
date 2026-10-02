import { lazy } from "react";

const loadTasksPage = () => import("../features/tasks/routes/TasksPage");
const loadPenaltiesPage = () => import("../features/penalties/routes/PenaltiesPage");
const loadSettingsPage = () => import("../features/settings/routes/SettingsPage");
const loadSummaryPage = () => import("../features/summary/routes/SummaryPage");
const loadReminderCalendarPage = () => import("../features/reminders/routes/ReminderCalendarPage");
const loadTodoCategoriesPage = () => import("../features/todos/routes/TodoCategoriesPage");
const loadTodoPage = () => import("../features/todos/routes/TodoPage");

// import自体がmoduleをキャッシュする。失敗したPromiseを独自に保持して再試行を妨げない。
export const preloadTasksPageChunk = loadTasksPage;
export const preloadPenaltiesPageChunk = loadPenaltiesPage;
export const preloadSettingsPageChunk = loadSettingsPage;
export const preloadSummaryPageChunk = loadSummaryPage;
export const preloadReminderCalendarPageChunk = loadReminderCalendarPage;
export const preloadTodoCategoriesPageChunk = loadTodoCategoriesPage;
export const preloadTodoPageChunk = loadTodoPage;

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

export const TodoPage = lazy(async () => {
  const module = await preloadTodoPageChunk();
  return { default: module.TodoPage };
});

export const TodoCategoriesPage = lazy(async () => {
  const module = await preloadTodoCategoriesPageChunk();
  return { default: module.TodoCategoriesPage };
});
