import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/invites")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", replace: true });
  },
});
