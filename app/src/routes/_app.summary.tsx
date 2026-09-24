import { createFileRoute } from "@tanstack/react-router";
import { SummaryPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/summary")({
  component: () =>
    withDataBoundary(<SummaryPage />, "サマリー画面の読み込みに失敗しました。", {
      fullScreenOnInitial: true,
    }),
});
