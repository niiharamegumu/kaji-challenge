import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/tasks")({
  component: () =>
    withDataBoundary(<TasksPage />, "タスク画面の読み込みに失敗しました。", {
      fullScreenOnInitial: true,
    }),
});
