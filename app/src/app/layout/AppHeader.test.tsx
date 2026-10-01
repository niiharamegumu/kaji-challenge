import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
let scrollY = 0;
let nextFrameId = 0;
let frames: Map<number, FrameRequestCallback>;
let resizeMembers: () => void;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  scrollY = 0;
  nextFrameId = 0;
  frames = new Map();
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeMembers = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY);
});

function renderHeader() {
  const view = render(
    <AppHeader teamName="Team A" todayLabel="2026年10月1日（木）">
      <button>メンバー</button>
    </AppHeader>,
  );
  const slot = screen.getByRole("banner").parentElement!;
  return { ...view, slot };
}

function scrollTo(y: number) {
  scrollY = y;
  fireEvent.scroll(window);
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
}

describe("AppHeader", () => {
  it("stays expanded near the top and restores a compact header only at the top", () => {
    const { slot } = renderHeader();
    expect(slot).toHaveAttribute("data-compact", "false");

    scrollTo(16);
    expect(slot).toHaveAttribute("data-compact", "false");
    scrollTo(17);
    expect(slot).toHaveAttribute("data-compact", "true");
    scrollTo(8);
    expect(slot).toHaveAttribute("data-compact", "true");
    scrollTo(0);
    expect(slot).toHaveAttribute("data-compact", "false");
  });

  it("starts compact when mounted at a restored scroll position", () => {
    scrollY = 80;
    const { slot } = renderHeader();
    expect(slot).toHaveAttribute("data-compact", "true");
    scrollTo(-2);
    expect(slot).toHaveAttribute("data-compact", "false");
  });

  it("updates the compact surface measurement when members change size", () => {
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(36);
    const { slot } = renderHeader();
    expect(slot.style.getPropertyValue("--app-header-members-width")).toBe("36px");

    width.mockReturnValue(84);
    act(() => resizeMembers());
    expect(slot.style.getPropertyValue("--app-header-members-width")).toBe("84px");
  });

  it("cancels queued scroll work and stops observing after unmount", () => {
    const { unmount } = renderHeader();
    scrollY = 80;
    fireEvent.scroll(window);
    fireEvent.scroll(window);
    expect(frames.size).toBe(1);

    unmount();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();

    fireEvent.scroll(window);
    expect(frames.size).toBe(0);
  });
});
