import type { Modifier } from "@dnd-kit/core";
import {
  type AnimateLayoutChanges,
  defaultAnimateLayoutChanges,
} from "@dnd-kit/sortable";

const SORTABLE_DROP_TRANSITION_MS = 180;

export const smoothSortableLayoutChanges: AnimateLayoutChanges = (args) => {
  if (args.wasDragging) {
    return false;
  }

  if (args.isSorting) {
    return defaultAnimateLayoutChanges(args);
  }

  return true;
};

export const smoothSortableTransition = {
  duration: SORTABLE_DROP_TRANSITION_MS,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};

export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});
