import { ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";

import type {
  ShoppingListItem,
  UpdateShoppingListItemRequest,
} from "../../../lib/api/generated/client";
import { ShoppingListItemsSection } from "../../shopping-list";
import { HOME_PANEL_CLASS_NAME } from "./panelStyles";

type Props = {
  items: ShoppingListItem[];
  isReordering: boolean;
  onDelete: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onUpdate: (
    itemId: string,
    payload: UpdateShoppingListItemRequest,
  ) => Promise<void>;
};

export function HomeShoppingListPanel({
  items,
  isReordering,
  onDelete,
  onReorder,
  onUpdate,
}: Props) {
  return (
    <article className={HOME_PANEL_CLASS_NAME}>
      <div className="flex items-center justify-between gap-2 px-2 md:px-0">
        <h2 className="text-lg font-semibold">買い物リスト</h2>
        <Link
          to="/shopping-list"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-stone-300 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900"
        >
          <ShoppingCart size={16} aria-hidden="true" />
          <span>買い物へ</span>
        </Link>
      </div>
      <ShoppingListItemsSection
        items={items}
        isReordering={isReordering}
        onDelete={onDelete}
        onReorder={onReorder}
        onUpdate={onUpdate}
        showSectionChrome={false}
        articleClassName="mt-2"
        listClassName=""
        emptyMessage="買い物項目はまだありません。必要なものを追加してください。"
        emptyClassName="mx-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-8 text-center text-sm text-stone-600 md:mx-0"
      />
    </article>
  );
}
