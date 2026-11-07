import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Square, SquareCheck } from "lucide-react";
import { useState } from "react";
import type { SharedPageBlock } from "../../../contracts/shared-pages";
import { restrictToVerticalAxis } from "../../../shared/utils/sortableAnimation";
import { isListItem } from "../model/listItems";

type Props = {
  blocks: SharedPageBlock[];
  onMove: (sourceId: string, targetId: string) => void;
};

export function ListOrderView({ blocks, onMove }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const last = blocks.at(-1);
  const trailingParagraph =
    last?.type === "paragraph" && !last.content.length && !last.children.length;
  return (
    <div role="group" aria-label="リストの並び替え">
      <SiblingList
        blocks={trailingParagraph ? blocks.slice(0, -1) : blocks}
        onMove={onMove}
        expanded={expanded}
        onExpand={setExpanded}
      />
    </div>
  );
}

type SiblingListProps = Props & {
  expanded: string | null;
  onExpand: (id: string | null) => void;
};

function SiblingList({ blocks, onMove, expanded, onExpand }: SiblingListProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  let number = 0;
  const rows = [];
  for (const [index, block] of blocks.entries()) {
    number = block.type === "numberedListItem" ? (block.props.start ?? number + 1) : 0;
    rows.push(
      <OrderRow
        key={block.id}
        block={block}
        number={number}
        previous={blocks[index - 1]?.id}
        next={blocks[index + 1]?.id}
        onMove={onMove}
        expanded={expanded}
        onExpand={onExpand}
      />,
    );
  }
  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      collisionDetection={(args) =>
        args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)
      }
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
      }}
    >
      <SortableContext
        items={blocks.map((block) => block.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="min-w-0">{rows}</ul>
      </SortableContext>
    </DndContext>
  );
}

function OrderRow({
  block,
  number,
  previous,
  next,
  onMove,
  expanded,
  onExpand,
}: Omit<SiblingListProps, "blocks"> & {
  block: SharedPageBlock;
  number: number;
  previous?: string;
  next?: string;
}) {
  const movable = isListItem(block.type);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id, disabled: { draggable: !movable } });
  const text = block.content
    .map((part) =>
      part.type === "text" ? part.text : part.content.map((text) => text.text).join(""),
    )
    .join("");
  const label = text || "空の項目";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "relative z-10 rounded-lg bg-surface shadow-md" : undefined}
    >
      <div className="flex min-w-0 items-start gap-2">
        {movable && (
          <span className="mt-3 shrink-0 select-none text-muted" aria-hidden="true">
            {block.type === "checkListItem" ? (
              block.props.checked ? (
                <SquareCheck size={16} />
              ) : (
                <Square size={16} />
              )
            ) : number ? (
              `${number}.`
            ) : (
              "•"
            )}
          </span>
        )}
        <span
          className={`min-w-0 flex-1 whitespace-pre-wrap break-words py-2 ${block.type === "heading" ? "font-semibold text-heading" : ""}`}
        >
          {text}
        </span>
        {movable && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`${label} をドラッグして並び替え`}
            title="並び替え"
            aria-expanded={expanded === block.id}
            className="shared-page-icon-button touch-none"
            onClick={() => onExpand(expanded === block.id ? null : block.id)}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded === block.id && (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            className="shared-page-icon-button"
            aria-label={`${label} を上へ移動`}
            title="上へ移動"
            disabled={!previous}
            onClick={() => previous && onMove(block.id, previous)}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="shared-page-icon-button"
            aria-label={`${label} を下へ移動`}
            title="下へ移動"
            disabled={!next}
            onClick={() => next && onMove(block.id, next)}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {block.children.length > 0 && (
        <div className="ml-2 border-l border-line pl-2">
          <SiblingList
            blocks={block.children}
            onMove={onMove}
            expanded={expanded}
            onExpand={onExpand}
          />
        </div>
      )}
    </li>
  );
}
