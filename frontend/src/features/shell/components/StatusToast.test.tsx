import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusToast } from "./StatusToast";

describe("StatusToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("auto dismisses after 5 seconds", () => {
    const onDismiss = vi.fn();

    render(<StatusToast message="保存しました" onDismiss={onDismiss} />);

    expect(screen.getByText("保存しました")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("auto dismisses action toasts as well", () => {
    const onDismiss = vi.fn();
    const onAction = vi.fn();

    render(
      <StatusToast
        message="新しいバージョンを利用できます。"
        onDismiss={onDismiss}
        actionLabel="更新する"
        onAction={onAction}
      />,
    );

    expect(
      screen.getByRole("button", { name: "更新する" }),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not restart the timer when action props change for the same message", () => {
    const onDismiss = vi.fn();
    const onAction = vi.fn();
    const { rerender } = render(
      <StatusToast message="同期しました" onDismiss={onDismiss} />,
    );

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    rerender(
      <StatusToast
        message="同期しました"
        onDismiss={onDismiss}
        actionLabel="詳細"
        onAction={onAction}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("restarts the timer when the message changes", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <StatusToast message="保存しました" onDismiss={onDismiss} />,
    );

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    rerender(<StatusToast message="更新しました" onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("pauses the timer while hovered", () => {
    const onDismiss = vi.fn();

    render(<StatusToast message="保存しました" onDismiss={onDismiss} />);

    fireEvent.mouseEnter(screen.getByTestId("status-message"));

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(screen.getByTestId("status-message"));

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
