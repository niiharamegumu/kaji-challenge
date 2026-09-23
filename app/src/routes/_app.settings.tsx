import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/settings")({
  component: () =>
    withDataBoundary(<SettingsPage />, "設定画面の読み込みに失敗しました。", {
      fullScreenOnInitial: true,
    }),
});
