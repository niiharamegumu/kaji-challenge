import { createFileRoute } from "@tanstack/react-router";
import { TodoCategoriesPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/todo-categories")({
  component: () =>
    withDataBoundary(<TodoCategoriesPage />, "カテゴリー管理画面の読み込みに失敗しました。", {
      fullScreenOnInitial: true,
    }),
});
