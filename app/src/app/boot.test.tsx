import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { BootScreen } from "../shared/components/BootScreen";
import { BootFlowProvider, useBootFlow } from "./boot";

function InitialOverlay() {
  const { isInitialBootPending } = useBootFlow();
  return isInitialBootPending ? <BootScreen mode="overlay" /> : null;
}

function Application() {
  const { isInitialBootPending, markReactMounted, markAuthResolved } = useBootFlow();
  return (
    <>
      <button onClick={markReactMounted}>React起動を完了</button>
      <button onClick={markAuthResolved}>認証確認を完了</button>
      {!isInitialBootPending ? <p>アプリを表示中</p> : null}
    </>
  );
}

function Harness({ overlayKey = "initial" }: { overlayKey?: string }) {
  return (
    <BootFlowProvider>
      <InitialOverlay key={overlayKey} />
      <Application />
    </BootFlowProvider>
  );
}

afterEach(cleanup);

describe("React boot flow", () => {
  it("renders the loading logo in the initial HTML before effects run", () => {
    const markup = renderToString(<Harness />);
    expect(markup).toContain('data-testid="boot-screen"');
    expect(markup).toContain('aria-label="読み込み中"');
  });

  it.each([
    ["React起動を完了", "認証確認を完了"],
    ["認証確認を完了", "React起動を完了"],
  ])("waits for both startup signals (%s then %s)", (first, second) => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: first }));
    expect(screen.getByRole("status", { name: "読み込み中" })).toBeVisible();
    expect(screen.queryByText("アプリを表示中")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: second }));
    expect(screen.queryByRole("status", { name: "読み込み中" })).not.toBeInTheDocument();
    expect(screen.getByText("アプリを表示中")).toBeVisible();
  });

  it("does not restore the overlay when its component remounts after startup", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "React起動を完了" }));
    fireEvent.click(screen.getByRole("button", { name: "認証確認を完了" }));

    rerender(<Harness overlayKey="hot-update" />);

    expect(screen.queryByRole("status", { name: "読み込み中" })).not.toBeInTheDocument();
    expect(screen.getByText("アプリを表示中")).toBeVisible();
  });

  it("waits for authentication again when a new application starts", () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "React起動を完了" }));
    fireEvent.click(screen.getByRole("button", { name: "認証確認を完了" }));
    unmount();

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "React起動を完了" }));

    expect(screen.getByRole("status", { name: "読み込み中" })).toBeVisible();
    expect(screen.queryByText("アプリを表示中")).not.toBeInTheDocument();
  });
});
