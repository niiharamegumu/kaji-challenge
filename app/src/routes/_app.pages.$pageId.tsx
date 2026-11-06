import { createFileRoute } from "@tanstack/react-router";
import { SharedPagesPage } from "../app/route-chunks";
import { withDataBoundary } from "../app/route-boundary";
export const Route = createFileRoute("/_app/pages/$pageId")({ component: SharedPageRoute });
function SharedPageRoute() {
  const { pageId } = Route.useParams();
  return withDataBoundary(
    <SharedPagesPage pageId={pageId} />,
    "共有ページの読み込みに失敗しました。",
    { fullScreenOnInitial: true },
  );
}
