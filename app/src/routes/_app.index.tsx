import { createFileRoute } from "@tanstack/react-router";
import { HomePage, HomePageSkeleton } from "../features/home/routes/HomePage";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/")({
  component: () =>
    withDataBoundary(<HomePage />, "ホーム画面の読み込みに失敗しました。", {
      loadingFallback: <HomePageSkeleton />,
    }),
});
