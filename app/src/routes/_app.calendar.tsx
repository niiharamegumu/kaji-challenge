import { createFileRoute } from "@tanstack/react-router";
import { ReminderCalendarPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/calendar")({
  component: () =>
    withDataBoundary(<ReminderCalendarPage />, "カレンダー画面の読み込みに失敗しました。", {
      fullScreenOnInitial: true,
    }),
});
