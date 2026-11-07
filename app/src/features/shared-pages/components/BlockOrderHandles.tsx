import {
  type CollisionDetection,
  DndContext,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { memo, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

type Row = {
  id: string;
  parentId?: string;
  previous?: string;
  next?: string;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  gripOffset: number;
};

type MoveBlock = (sourceId: string, targetId: string) => void;

// Measure the rendered rows, including their nesting and line wrapping. The
// controls live outside contenteditable so they never enter IME or clipboard data.
function useBlockRows(editorRoot: RefObject<HTMLDivElement | null>) {
  const [rows, setRows] = useState<Row[]>([]);
  useLayoutEffect(() => {
    const root = editorRoot.current;
    if (!root) return;
    let frame = 0;
    let observed = new Set<HTMLElement>();
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    function measure() {
      if (!root) return;
      frame = 0;
      const origin = root.getBoundingClientRect();
      const style = getComputedStyle(root);
      const gripWidth = parseFloat(style.getPropertyValue("--shared-page-grip-width"));
      const gripHeight = parseFloat(style.getPropertyValue("--shared-page-row-height"));
      const contents = root.querySelectorAll<HTMLElement>(".bn-block > .bn-block-content");
      const current = new Set(contents);
      for (const content of observed) if (!current.has(content)) resize.unobserve(content);
      for (const content of current) if (!observed.has(content)) resize.observe(content);
      observed = current;

      const measured: Row[] = [];
      const lastSibling = new Map<string | undefined, Row>();
      for (const content of contents) {
        const outer = content.closest<HTMLElement>(".bn-block-outer");
        if (!outer?.dataset.id) continue;
        const parentId = outer.parentElement?.closest<HTMLElement>(".bn-block-outer")?.dataset.id;
        const inline = content.querySelector<HTMLElement>(".bn-inline-content");
        const text = inline?.textContent?.trim();
        // BlockNote appends an empty insertion paragraph after the last block.
        if (
          measured.length &&
          !parentId &&
          !outer.nextElementSibling &&
          !text &&
          content.dataset.contentType === "paragraph" &&
          !content.nextElementSibling
        )
          continue;
        const rect = content.getBoundingClientRect();
        // Align the grip with the first line of a large or wrapped heading.
        const gripOffset =
          inline && content.dataset.contentType === "heading"
            ? Math.max(
                0,
                inline.getBoundingClientRect().top -
                  rect.top +
                  ((parseFloat(getComputedStyle(inline).lineHeight) || gripHeight) - gripHeight) /
                    2,
              )
            : 0;
        const previous = lastSibling.get(parentId);
        const row: Row = {
          id: outer.dataset.id,
          parentId,
          previous: previous?.id,
          label: text?.slice(0, 80) || "空の項目",
          left: rect.left - origin.left - gripWidth,
          top: rect.top - origin.top,
          width: rect.width + gripWidth,
          height: outer.getBoundingClientRect().bottom - rect.top,
          gripOffset,
        };
        if (previous) previous.next = row.id;
        lastSibling.set(parentId, row);
        measured.push(row);
      }
      setRows(measured);
    }
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-id", "data-content-type", "data-level"],
    });
    resize.observe(root);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [editorRoot]);
  return rows;
}

const siblingUnderPointer: CollisionDetection = (args) =>
  pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.data.current?.parentId === args.active.data.current?.parentId,
    ),
  });

export function BlockOrderHandles({
  editorRoot,
  onMove,
}: {
  editorRoot: RefObject<HTMLDivElement | null>;
  onMove: MoveBlock;
}) {
  const rows = useBlockRows(editorRoot);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const sourceIndex = dragging ? rows.findIndex((row) => row.id === dragging) : -1;
  const handles = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
  );
  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !handles.current?.contains(event.target)) {
        setExpanded(null);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [expanded]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={siblingUnderPointer}
      accessibility={{
        screenReaderInstructions: { draggable: "ボタンを押すと上下に移動できます。" },
      }}
      onDragStart={({ active }) => {
        setExpanded(null);
        setDragging(String(active.id));
      }}
      onDragCancel={() => setDragging(null)}
      onDragEnd={({ active, over }) => {
        setDragging(null);
        if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
      }}
    >
      <div
        ref={handles}
        className="shared-page-block-handles"
        role="group"
        aria-label="ブロックの並び替え"
      >
        {rows.map((row, index) => (
          <BlockHandle
            key={row.id}
            {...row}
            expanded={expanded === row.id}
            dropAfter={sourceIndex >= 0 && index > sourceIndex}
            onExpand={setExpanded}
            onMove={onMove}
          />
        ))}
      </div>
    </DndContext>
  );
}

const BlockHandle = memo(function BlockHandle({
  id,
  parentId,
  previous,
  next,
  label,
  left,
  top,
  width,
  height,
  gripOffset,
  expanded,
  dropAfter,
  onExpand,
  onMove,
}: Row & {
  expanded: boolean;
  dropAfter: boolean;
  onExpand: (id: string | null) => void;
  onMove: MoveBlock;
}) {
  const movesId = useId();
  const {
    attributes,
    listeners,
    node: grip,
    setNodeRef: setGrip,
    isDragging,
  } = useDraggable({
    id,
    data: { parentId },
    attributes: { roleDescription: "並び替え" },
  });
  const { setNodeRef: setRow, isOver } = useDroppable({ id, data: { parentId } });
  const move = (target: string) => {
    onMove(id, target);
    onExpand(null);
    grip.current?.focus({ preventScroll: true });
  };
  return (
    <div
      ref={setRow}
      className="shared-page-block-handle-row"
      style={{ left, top, width, height, paddingTop: gripOffset }}
      data-dragging={isDragging || undefined}
      data-drop-edge={isOver && !isDragging ? (dropAfter ? "after" : "before") : undefined}
      onKeyDown={(event) => {
        if (expanded && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onExpand(null);
          grip.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (expanded && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          onExpand(null);
        }
      }}
    >
      <button
        ref={setGrip}
        type="button"
        {...attributes}
        {...listeners}
        className="shared-page-icon-button shared-page-block-grip"
        aria-label={`${label} をドラッグして並び替え`}
        aria-controls={expanded ? movesId : undefined}
        aria-expanded={expanded}
        title="並び替え"
        onClick={() => onExpand(expanded ? null : id)}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      {expanded && (
        <div
          id={movesId}
          className="shared-page-block-moves"
          style={{ top: gripOffset }}
          role="group"
          aria-label="移動先"
        >
          <button
            type="button"
            className="shared-page-icon-button"
            aria-label={`${label} を上へ移動`}
            title="上へ移動"
            disabled={!previous}
            onClick={() => previous && move(previous)}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="shared-page-icon-button"
            aria-label={`${label} を下へ移動`}
            title="下へ移動"
            disabled={!next}
            onClick={() => next && move(next)}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
});
