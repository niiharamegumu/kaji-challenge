import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import { AuthCallbackPage, authCallbackLoader } from "./auth-callback";
import { HomePage } from "./home-page";
import { RootLayout } from "./root-layout";

const AdminPage = lazy(async () => {
  const module = await import("./admin-page");
  return { default: module.AdminPage };
});

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
        element: (
          <Suspense fallback={<div className="mt-4 text-sm text-stone-600">管理画面を読み込み中...</div>}>
            <AdminPage />
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
