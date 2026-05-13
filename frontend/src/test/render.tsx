import { type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { AppProviders } from "../app/providers";
import { SuspenseQueryBoundary } from "../shared/components/SuspenseQueryBoundary";
import { appQueryClient } from "../shared/query/queryClient";

type RenderWithProvidersOptions = RenderOptions & {
  errorMessage?: string;
};

export const resetTestQueryClient = () => {
  appQueryClient.clear();
};

export const renderWithProviders = (
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
) => {
  const { errorMessage = "テスト用エラー", ...renderOptions } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders>
      <SuspenseQueryBoundary errorMessage={errorMessage}>
        {children}
      </SuspenseQueryBoundary>
    </AppProviders>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};
