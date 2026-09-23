import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { searchOptions } from "./shared/router/search";
export function getRouter() {
  return createRouter({
    ...searchOptions,
    routeTree,
    scrollRestoration: true,
    defaultPreload: false,
  });
}
