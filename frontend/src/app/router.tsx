import type { ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import {
  AuthCallbackPage,
  authCallbackLoader,
} from "../features/auth/routes/AuthCallbackPage";
import { HomePage, HomePageSkeleton } from "../features/home/routes/HomePage";
import { SuspenseQueryBoundary } from "../shared/components/SuspenseQueryBoundary";
import { InitialViewReady } from "./boot";
import { RootLayout } from "./layout/RootLayout";
import {
  AdminInvitesPage,
  AdminPenaltiesPage,
  AdminSummaryPage,
  AdminTasksPage,
  ReminderCalendarPage,
  ShoppingListPage,
} from "./route-chunks";

const withDataBoundary = (
  element: ReactNode,
  errorMessage: string,
  options?: {
    fullScreenOnInitial?: boolean;
    loadingFallback?: ReactNode;
  },
) => (
  <SuspenseQueryBoundary
    errorMessage={errorMessage}
    fullScreenOnInitial={options?.fullScreenOnInitial}
    loadingFallback={options?.loadingFallback}
  >
    <InitialViewReady>{element}</InitialViewReady>
  </SuspenseQueryBoundary>
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: withDataBoundary(
          <HomePage />,
          "ホーム画面の読み込みに失敗しました。",
          { loadingFallback: <HomePageSkeleton /> },
        ),
      },
      {
        path: "admin",
        element: <Navigate to="/admin/tasks" replace />,
      },
      {
        path: "admin/tasks",
        element: withDataBoundary(
          <AdminTasksPage />,
          "タスク画面の読み込みに失敗しました。",
          { fullScreenOnInitial: true },
        ),
      },
      {
        path: "admin/penalties",
        element: withDataBoundary(
          <AdminPenaltiesPage />,
          "ペナルティ画面の読み込みに失敗しました。",
          { fullScreenOnInitial: true },
        ),
      },
      {
        path: "admin/settings",
        element: withDataBoundary(
          <AdminInvitesPage />,
          "設定画面の読み込みに失敗しました。",
          { fullScreenOnInitial: true },
        ),
      },
      {
        path: "admin/invites",
        element: <Navigate to="/admin/settings" replace />,
      },
      {
        path: "admin/summary",
        element: withDataBoundary(
          <AdminSummaryPage />,
          "サマリー画面の読み込みに失敗しました。",
          { fullScreenOnInitial: true },
        ),
      },
      {
        path: "calendar",
        element: withDataBoundary(
          <ReminderCalendarPage />,
          "カレンダー画面の読み込みに失敗しました。",
          { fullScreenOnInitial: true },
        ),
      },
      {
        path: "shopping-list",
        element: withDataBoundary(
          <ShoppingListPage />,
          "買い物リスト画面の読み込みに失敗しました。",
          { fullScreenOnInitial: true },
        ),
      },
    ],
  },
  {
    path: "/auth/callback",
    loader: authCallbackLoader,
    element: <AuthCallbackPage />,
  },
]);
