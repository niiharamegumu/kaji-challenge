import { createFileRoute } from "@tanstack/react-router";
import { ShoppingListPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/shopping-list")({
  component: () =>
    withDataBoundary(<ShoppingListPage />, "買い物リスト画面の読み込みに失敗しました。", {
      fullScreenOnInitial: true,
    }),
});
