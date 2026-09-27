import { useId } from "react";

export function TodoCategoryInput({
  value,
  onChange,
  categories,
}: {
  value: string;
  onChange: (value: string) => void;
  categories: string[];
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <label className="text-xs text-stone-700 sm:text-sm" htmlFor={id}>
        カテゴリー（任意）
      </label>
      <input
        id={id}
        list={`${id}-options`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={50}
        placeholder="登録済みから選択、または自由に入力"
        className="h-10 min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
      />
      <datalist id={`${id}-options`}>
        {categories.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <p className="text-xs text-stone-500">空欄にすると未分類になります。</p>
    </div>
  );
}
