import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DelayedActionProvider, useDelayedActions } from "./DelayedActionProvider";
import { ActionCountdown } from "../components/ActionCountdown";

function Actions({ onComplete }: { onComplete: (id: string) => void }) {
  const { schedule, pendingActions, undo } = useDelayedActions();
  return (
    <>
      {["牛乳", "卵"].map((name) => (
        <div key={name}>
          <button onClick={() => schedule(name, onComplete)}>{name}を完了</button>
          {pendingActions.some((item) => item.id === name) ? (
            <button onClick={() => undo(name)}>{name}の完了を取り消す</button>
          ) : null}
        </div>
      ))}
      {pendingActions.map((item) => (
        <ActionCountdown key={item.id} deadline={item.deadline} />
      ))}
    </>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("runs each completion once after three seconds, including under StrictMode", () => {
  const onComplete = vi.fn();
  render(
    <StrictMode>
      <DelayedActionProvider>
        <Actions onComplete={onComplete} />
      </DelayedActionProvider>
    </StrictMode>,
  );
  fireEvent.click(screen.getByText("牛乳を完了"));
  fireEvent.click(screen.getByText("牛乳を完了"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "牛乳の完了を取り消す" })).toHaveLength(1);
  act(() => vi.advanceTimersByTime(2_999));
  expect(onComplete).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onComplete).toHaveBeenCalledExactlyOnceWith("牛乳");
  expect(screen.queryByRole("button", { name: "牛乳の完了を取り消す" })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(3_000));
  expect(onComplete).toHaveBeenCalledTimes(1);
});

it("cancels the original timer and gives a repeated completion its own three seconds", () => {
  const onComplete = vi.fn();
  render(
    <DelayedActionProvider>
      <Actions onComplete={onComplete} />
    </DelayedActionProvider>,
  );
  fireEvent.click(screen.getByText("牛乳を完了"));
  act(() => vi.advanceTimersByTime(2_999));
  fireEvent.click(screen.getByRole("button", { name: "牛乳の完了を取り消す" }));
  expect(screen.queryByRole("button", { name: "牛乳の完了を取り消す" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("牛乳を完了"));
  act(() => vi.advanceTimersByTime(2_999));
  expect(onComplete).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onComplete).toHaveBeenCalledExactlyOnceWith("牛乳");
});

it("keeps multiple completions and undo operations independent", () => {
  const onComplete = vi.fn();
  render(
    <DelayedActionProvider>
      <Actions onComplete={onComplete} />
    </DelayedActionProvider>,
  );
  fireEvent.click(screen.getByText("牛乳を完了"));
  act(() => vi.advanceTimersByTime(1_000));
  fireEvent.click(screen.getByText("卵を完了"));
  fireEvent.click(screen.getByRole("button", { name: "牛乳の完了を取り消す" }));
  act(() => vi.advanceTimersByTime(2_999));
  expect(onComplete).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "卵の完了を取り消す" })).toBeVisible();
  act(() => vi.advanceTimersByTime(1));
  expect(onComplete).toHaveBeenCalledExactlyOnceWith("卵");
});

it.each([false, true])(
  "keeps completion across pages and allows undo from a new consumer (undo: %s)",
  (undo) => {
    const onComplete = vi.fn();
    const view = render(
      <DelayedActionProvider>
        <Actions onComplete={onComplete} />
      </DelayedActionProvider>,
    );
    fireEvent.click(screen.getByText("牛乳を完了"));
    act(() => vi.advanceTimersByTime(1_000));
    view.rerender(
      <DelayedActionProvider>
        <p>別の画面</p>
        {undo ? <Actions key="next-page" onComplete={onComplete} /> : null}
      </DelayedActionProvider>,
    );
    if (undo) {
      const button = screen.getByRole("button", { name: "牛乳の完了を取り消す" });
      expect(button).toBeVisible();
      expect(screen.getByRole("img", { name: "完了まで2秒" })).toBeVisible();
      fireEvent.click(button);
    }
    act(() => vi.advanceTimersByTime(2_000));
    expect(onComplete.mock.calls).toEqual(undo ? [] : [["牛乳"]]);
  },
);

it.each(["unmount", "identity"])(
  "discards all timers on %s without sending completions",
  (change) => {
    const onComplete = vi.fn();
    const view = render(
      <DelayedActionProvider key="user:team-a">
        <Actions onComplete={onComplete} />
      </DelayedActionProvider>,
    );
    fireEvent.click(screen.getByText("牛乳を完了"));
    fireEvent.click(screen.getByText("卵を完了"));
    act(() => vi.advanceTimersByTime(2_999));
    if (change === "unmount") view.unmount();
    else
      view.rerender(
        <DelayedActionProvider key="user:team-b">
          <Actions onComplete={onComplete} />
        </DelayedActionProvider>,
      );
    act(() => vi.advanceTimersByTime(3_000));
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /の完了を取り消す/ })).not.toBeInTheDocument();
  },
);
