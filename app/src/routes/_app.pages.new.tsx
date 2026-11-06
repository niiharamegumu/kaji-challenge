import { createFileRoute } from "@tanstack/react-router";
import { SharedPagesPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/pages/new")({
  component: () =>
    withDataBoundary(<SharedPagesPage newPage />, "共有ページの読み込みに失敗しました。", {
      fullScreenOnInitial: true,
    }),
});
