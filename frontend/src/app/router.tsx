import { type ReactNode, lazy } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";

import {
  AuthCallbackPage,
  authCallbackLoader,
} from "../features/auth/routes/AuthCallbackPage";
import { RootLayout } from "../features/shell/routes/RootLayout";
import { SuspenseQueryBoundary } from "../shared/components/SuspenseQueryBoundary";
import { InitialViewReady } from "./boot";

const HomePage = lazy(async () => {
  const module = await import("../features/home/routes/HomePage");
  return { default: module.HomePage };
});

const AdminTasksPage = lazy(async () => {
  const module = await import("../features/admin/routes/AdminTasksPage");
  return { default: module.AdminTasksPage };
});

const AdminPenaltiesPage = lazy(async () => {
  const module = await import("../features/admin/routes/AdminPenaltiesPage");
  return { default: module.AdminPenaltiesPage };
});

const AdminInvitesPage = lazy(async () => {
  const module = await import("../features/admin/routes/AdminInvitesPage");
  return { default: module.AdminInvitesPage };
});

const AdminSummaryPage = lazy(async () => {
  const module = await import("../features/admin/routes/AdminSummaryPage");
  return { default: module.AdminSummaryPage };
});

const ShoppingListPage = lazy(async () => {
  const module = await import(
    "../features/shopping-list/routes/ShoppingListPage"
  );
  return { default: module.ShoppingListPage };
});

const withDataBoundary = (element: ReactNode, errorMessage: string) => (
  <SuspenseQueryBoundary errorMessage={errorMessage} fullScreenOnInitial>
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
        ),
      },
      {
        path: "admin/penalties",
        element: withDataBoundary(
          <AdminPenaltiesPage />,
          "ペナルティ画面の読み込みに失敗しました。",
        ),
      },
      {
        path: "admin/settings",
        element: withDataBoundary(
          <AdminInvitesPage />,
          "設定画面の読み込みに失敗しました。",
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
        ),
      },
      {
        path: "shopping-list",
        element: withDataBoundary(
          <ShoppingListPage />,
          "買い物リスト画面の読み込みに失敗しました。",
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
