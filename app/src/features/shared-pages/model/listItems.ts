import type { SharedPageBlock } from "../../../contracts/shared-pages";

export function isListItem(type: string) {
  return type === "bulletListItem" || type === "numberedListItem" || type === "checkListItem";
}

export function containsListItems(blocks: SharedPageBlock[]): boolean {
  return blocks.some((block) => isListItem(block.type) || containsListItems(block.children));
}
