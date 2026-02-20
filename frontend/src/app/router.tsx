import { Suspense, lazy } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";

import {
  AuthCallbackPage,
  authCallbackLoader,
} from "../features/auth/routes/AuthCallbackPage";
import { HomePage } from "../features/home/routes/HomePage";
import { RootLayout } from "../features/shell/routes/RootLayout";

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

const adminFallback = (
  <div className="mt-4 text-sm text-stone-600">管理画面を読み込み中...</div>
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "admin",
        element: <Navigate to="/admin/tasks" replace />,
      },
      {
        path: "admin/tasks",
        element: (
          <Suspense fallback={adminFallback}>
            <AdminTasksPage />
          </Suspense>
        ),
      },
      {
        path: "admin/penalties",
        element: (
          <Suspense fallback={adminFallback}>
            <AdminPenaltiesPage />
          </Suspense>
        ),
      },
      {
        path: "admin/settings",
        element: (
          <Suspense fallback={adminFallback}>
            <AdminInvitesPage />
          </Suspense>
        ),
      },
      {
        path: "admin/invites",
        element: <Navigate to="/admin/settings" replace />,
      },
      {
        path: "admin/summary",
        element: (
          <Suspense fallback={adminFallback}>
            <AdminSummaryPage />
          </Suspense>
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
