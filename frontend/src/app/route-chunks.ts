import { lazy } from "react";

const loadAdminTasksPage = () =>
  import("../features/admin/routes/AdminTasksPage");
const loadAdminPenaltiesPage = () =>
  import("../features/admin/routes/AdminPenaltiesPage");
const loadAdminInvitesPage = () =>
  import("../features/admin/routes/AdminInvitesPage");
const loadAdminSummaryPage = () =>
  import("../features/admin/routes/AdminSummaryPage");
const loadReminderCalendarPage = () =>
  import("../features/reminders/routes/ReminderCalendarPage");
const loadShoppingListPage = () =>
  import("../features/shopping-list/routes/ShoppingListPage");

let adminTasksPagePromise: Promise<
  typeof import("../features/admin/routes/AdminTasksPage")
> | null = null;
let adminPenaltiesPagePromise: Promise<
  typeof import("../features/admin/routes/AdminPenaltiesPage")
> | null = null;
let adminInvitesPagePromise: Promise<
  typeof import("../features/admin/routes/AdminInvitesPage")
> | null = null;
let adminSummaryPagePromise: Promise<
  typeof import("../features/admin/routes/AdminSummaryPage")
> | null = null;
let reminderCalendarPagePromise: Promise<
  typeof import("../features/reminders/routes/ReminderCalendarPage")
> | null = null;
let shoppingListPagePromise: Promise<
  typeof import("../features/shopping-list/routes/ShoppingListPage")
> | null = null;

export function preloadAdminTasksPageChunk() {
  adminTasksPagePromise ??= loadAdminTasksPage();
  return adminTasksPagePromise;
}

export function preloadAdminPenaltiesPageChunk() {
  adminPenaltiesPagePromise ??= loadAdminPenaltiesPage();
  return adminPenaltiesPagePromise;
}

export function preloadAdminInvitesPageChunk() {
  adminInvitesPagePromise ??= loadAdminInvitesPage();
  return adminInvitesPagePromise;
}

export function preloadAdminSummaryPageChunk() {
  adminSummaryPagePromise ??= loadAdminSummaryPage();
  return adminSummaryPagePromise;
}

export function preloadReminderCalendarPageChunk() {
  reminderCalendarPagePromise ??= loadReminderCalendarPage();
  return reminderCalendarPagePromise;
}

export function preloadShoppingListPageChunk() {
  shoppingListPagePromise ??= loadShoppingListPage();
  return shoppingListPagePromise;
}

export const AdminTasksPage = lazy(async () => {
  const module = await preloadAdminTasksPageChunk();
  return { default: module.AdminTasksPage };
});

export const AdminPenaltiesPage = lazy(async () => {
  const module = await preloadAdminPenaltiesPageChunk();
  return { default: module.AdminPenaltiesPage };
});

export const AdminInvitesPage = lazy(async () => {
  const module = await preloadAdminInvitesPageChunk();
  return { default: module.AdminInvitesPage };
});

export const AdminSummaryPage = lazy(async () => {
  const module = await preloadAdminSummaryPageChunk();
  return { default: module.AdminSummaryPage };
});

export const ReminderCalendarPage = lazy(async () => {
  const module = await preloadReminderCalendarPageChunk();
  return { default: module.ReminderCalendarPage };
});

export const ShoppingListPage = lazy(async () => {
  const module = await preloadShoppingListPageChunk();
  return { default: module.ShoppingListPage };
});
