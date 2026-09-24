import { createFileRoute } from "@tanstack/react-router";
import { PenaltiesPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/penalties")({
  component: () =>
    withDataBoundary(<PenaltiesPage />, "ペナルティ画面の読み込みに失敗しました。", {
      fullScreenOnInitial: true,
    }),
});
