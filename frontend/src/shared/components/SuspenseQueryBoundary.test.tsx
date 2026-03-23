import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, lazy } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { BootFlowProvider, InitialViewReady } from "../../app/boot";
import { SuspenseQueryBoundary } from "./SuspenseQueryBoundary";

const NeverResolves = lazy(
  async () =>
    new Promise<{
      default: () => null;
    }>(() => {}),
);

function renderWithBoot(children: ReactNode) {
  return render(<BootFlowProvider>{children}</BootFlowProvider>);
}

afterEach(() => {
  cleanup();
});

function BoundaryHarness({ showPending }: { showPending: boolean }) {
  return (
    <BootFlowProvider>
      <SuspenseQueryBoundary
        errorMessage="読み込みに失敗しました。"
        fullScreenOnInitial
      >
        {showPending ? (
          <NeverResolves />
        ) : (
          <InitialViewReady>
            <div>ready</div>
          </InitialViewReady>
        )}
      </SuspenseQueryBoundary>
    </BootFlowProvider>
  );
}

describe("SuspenseQueryBoundary", () => {
  it("shows the full-screen boot fallback on the initial suspense state", () => {
    renderWithBoot(
      <SuspenseQueryBoundary
        errorMessage="読み込みに失敗しました。"
        fullScreenOnInitial
      >
        <NeverResolves />
      </SuspenseQueryBoundary>,
    );

    expect(screen.getByRole("status", { name: "読み込み中" })).toBeVisible();
  });

  it("falls back to the inline loader after the initial screen is ready", async () => {
    const { rerender } = render(<BoundaryHarness showPending={false} />);

    await waitFor(() => {
      expect(screen.getByText("ready")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("boot-screen")).not.toBeInTheDocument();
    });

    rerender(<BoundaryHarness showPending />);

    await waitFor(() => {
      const statuses = screen.getAllByRole("status", { name: "読み込み中" });
      expect(statuses).toHaveLength(1);
      expect(screen.queryByTestId("boot-screen")).not.toBeInTheDocument();
    });
  });
});
