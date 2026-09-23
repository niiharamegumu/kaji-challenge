import {
  Link as RouterLink,
  Navigate as RouterNavigate,
  Outlet,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useContext, type ComponentProps } from "react";
import { RootLayoutContext } from "./rootLayoutContext";
export { Outlet, useLocation };
function destination(to: string) {
  const url = new URL(to, "https://kaji.invalid");
  return {
    to: url.pathname,
    search: Object.fromEntries(url.searchParams),
    hash: url.hash.slice(1),
  };
}
export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (to: string, options?: { replace?: boolean }) => {
      void router.navigate({ ...destination(to), ...options });
    },
    [router],
  );
}
export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  return <RouterNavigate {...destination(to)} replace={replace} />;
}
export function Link({ to, ...props }: Omit<ComponentProps<"a">, "href"> & { to: string }) {
  return <RouterLink {...destination(to)} {...props} />;
}
export function useSearchParams(): [
  URLSearchParams,
  (
    next: URLSearchParams | ((previous: URLSearchParams) => URLSearchParams),
    options?: { replace?: boolean },
  ) => void,
] {
  const location = useLocation();
  const router = useRouter();
  const set = useCallback(
    (
      next: URLSearchParams | ((previous: URLSearchParams) => URLSearchParams),
      options?: { replace?: boolean },
    ) => {
      const previous = new URLSearchParams(router.state.location.searchStr);
      const value = typeof next === "function" ? next(previous) : next;
      void router.navigate({
        to: router.state.location.pathname,
        search: Object.fromEntries(value),
        replace: options?.replace,
      });
    },
    [router],
  );
  return [new URLSearchParams(location.searchStr), set];
}
export function useOutletContext<T>() {
  const value = useContext(RootLayoutContext);
  if (!value) throw new Error("Root layout context is missing");
  return value as T;
}
