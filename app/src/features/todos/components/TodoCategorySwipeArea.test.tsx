import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodoCategorySwipeArea } from "./TodoCategorySwipeArea";

const pointer = {
  pointerId: 1,
  pointerType: "touch",
  isPrimary: true,
  clientX: 160,
  clientY: 100,
};

afterEach(cleanup);

function setup() {
  const onSwipe = vi.fn();
  render(
    <TodoCategorySwipeArea onSwipe={onSwipe}>
      <p>一覧</p>
      <button type="button" onPointerDown={(event) => event.stopPropagation()}>
        並べ替え
      </button>
      <a href="https://example.com">メモのリンク</a>
      <input aria-label="名前" />
      <fieldset>
        <p>編集中のフォーム</p>
      </fieldset>
    </TodoCategorySwipeArea>,
  );
  return { onSwipe, target: screen.getByText("一覧") };
}

describe("TodoCategorySwipeArea", () => {
  it.each([
    [60, "next"],
    [260, "previous"],
  ] as const)("switches once on release at x=%s", (clientX, direction) => {
    const { onSwipe, target } = setup();
    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerMove(target, { ...pointer, clientX, clientY: 105 });
    expect(onSwipe).not.toHaveBeenCalled();
    fireEvent.pointerUp(target, { ...pointer, clientX, clientY: 105 });
    fireEvent.pointerUp(target, { ...pointer, clientX, clientY: 105 });
    expect(onSwipe).toHaveBeenCalledExactlyOnceWith(direction);
  });

  it.each([
    [160, 100, "tap"],
    [130, 100, "short horizontal move"],
    [150, 220, "vertical scroll"],
    [60, 180, "diagonal move"],
  ])("ignores a %s/%s %s", (clientX, clientY) => {
    const { onSwipe, target } = setup();
    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerMove(target, { ...pointer, clientX, clientY });
    fireEvent.pointerUp(target, { ...pointer, clientX, clientY });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("does not convert a vertical scroll into a swipe when the finger changes direction", () => {
    const { onSwipe, target } = setup();
    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerMove(target, { ...pointer, clientY: 120 });
    fireEvent.pointerUp(target, { ...pointer, clientX: 60, clientY: 120 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it.each(["pointerCancel", "lostPointerCapture", "pointerLeave"] as const)(
    "discards %s and accepts the next gesture",
    (event) => {
      const { onSwipe, target } = setup();
      fireEvent.pointerDown(target, pointer);
      fireEvent[event](target, pointer);
      fireEvent.pointerUp(target, { ...pointer, clientX: 60 });
      expect(onSwipe).not.toHaveBeenCalled();
      fireEvent.pointerDown(target, pointer);
      fireEvent.pointerUp(target, { ...pointer, clientX: 60 });
      expect(onSwipe).toHaveBeenCalledExactlyOnceWith("next");
    },
  );

  it("ignores multi-touch even when the second finger starts on a control", () => {
    const { onSwipe, target } = setup();
    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerDown(screen.getByRole("button"), {
      ...pointer,
      pointerId: 2,
      isPrimary: false,
    });
    fireEvent.pointerUp(target, { ...pointer, clientX: 60 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it.each(["pointerUp", "pointerCancel", "lostPointerCapture", "pointerLeave"] as const)(
    "ignores %s from an unrelated pointer",
    (event) => {
      const { onSwipe, target } = setup();
      fireEvent.pointerDown(target, pointer);
      fireEvent[event](target, { ...pointer, pointerId: 2, pointerType: "mouse", clientX: 60 });
      expect(onSwipe).not.toHaveBeenCalled();
      fireEvent.pointerUp(target, { ...pointer, clientX: 60 });
      expect(onSwipe).toHaveBeenCalledExactlyOnceWith("next");
    },
  );

  it("preserves mouse text selection", () => {
    const { onSwipe, target } = setup();
    fireEvent.pointerDown(target, { ...pointer, pointerType: "mouse" });
    fireEvent.pointerUp(target, { ...pointer, pointerType: "mouse", clientX: 60 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it.each(["並べ替え", "メモのリンク", "名前", "編集中のフォーム"])(
    "ignores gestures starting on %s",
    (name) => {
      const { onSwipe } = setup();
      const target = name === "名前" ? screen.getByLabelText(name) : screen.getByText(name);
      fireEvent.pointerDown(target, pointer);
      fireEvent.pointerUp(target, { ...pointer, clientX: 60 });
      expect(onSwipe).not.toHaveBeenCalled();
    },
  );
});
