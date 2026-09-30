import { useRef, type PointerEvent, type ReactNode } from "react";

export type TodoCategorySwipeDirection = "previous" | "next";

const SWIPE_DISTANCE_PX = 48;
const SCROLL_DIRECTION_DISTANCE_PX = 8;
const INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, label, fieldset, [contenteditable], [role='dialog']";

export function TodoCategorySwipeArea({
  children,
  onSwipe,
}: {
  children: ReactNode;
  onSwipe?: (direction: TodoCategorySwipeDirection) => void;
}) {
  const gesture = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  if (onSwipe === undefined) return children;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    // A second finger cancels the gesture so pinch zoom cannot change the filter.
    if (!event.isPrimary) {
      gesture.current = null;
      return;
    }
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) {
      return;
    }
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (start === null || start.pointerId !== event.pointerId) return;
    const x = Math.abs(event.clientX - start.x);
    const y = Math.abs(event.clientY - start.y);
    if (y > SCROLL_DIRECTION_DISTANCE_PX && y >= x) gesture.current = null;
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (start === null || start.pointerId !== event.pointerId) return;
    gesture.current = null;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    if (Math.abs(x) >= SWIPE_DISTANCE_PX && Math.abs(x) > Math.abs(y) * 1.5) {
      onSwipe(x < 0 ? "next" : "previous");
    }
  };

  const cancelGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null;
  };

  return (
    <div
      className="[touch-action:pan-y_pinch-zoom]"
      onPointerDownCapture={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={cancelGesture}
      onPointerLeave={cancelGesture}
    >
      {children}
    </div>
  );
}
