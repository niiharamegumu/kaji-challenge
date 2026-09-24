import { searchOptions } from "../shared/router/search";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { useState, type PropsWithChildren } from "react";
export function MemoryRouter({
  children,
  initialEntries = ["/"],
}: PropsWithChildren<{ initialEntries?: string[] }>) {
  const [router] = useState(() => {
    const root = createRootRoute({ component: () => <>{children}</> });
    const child = createRoute({ getParentRoute: () => root, path: "$" });
    return createRouter({
      ...searchOptions,
      routeTree: root.addChildren([child]),
      history: createMemoryHistory({ initialEntries }),
      defaultPendingMs: 0,
    });
  });
  return <RouterContextProvider router={router}>{children}</RouterContextProvider>;
}
