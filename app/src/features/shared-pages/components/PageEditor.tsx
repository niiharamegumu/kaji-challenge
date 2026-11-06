import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { ja } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  useCreateBlockNote,
} from "@blocknote/react";
import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SharedPageBlock, SharedPageDocument } from "../../../contracts/shared-pages";
import "@blocknote/mantine/style.css";
import "../shared-pages.css";

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
  },
  inlineContentSpecs: {
    text: defaultInlineContentSpecs.text,
    link: defaultInlineContentSpecs.link,
  },
  styleSpecs: {
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    underline: defaultStyleSpecs.underline,
    strike: defaultStyleSpecs.strike,
    code: defaultStyleSpecs.code,
  },
});

// Unsupported pasted block colors never become hidden, unsavable formatting.
function documentBlocks(blocks: (typeof schema.Block)[]): SharedPageBlock[] {
  return blocks.map((block) => ({
    id: block.id,
    type: block.type,
    props: {
      textColor: "default",
      backgroundColor: "default",
      textAlignment: block.props.textAlignment,
      ...(block.type === "heading"
        ? {
            level:
              block.props.level === 1
                ? (1 as const)
                : block.props.level === 2
                  ? (2 as const)
                  : (3 as const),
          }
        : {}),
      ...(block.type === "checkListItem" ? { checked: block.props.checked } : {}),
      ...(block.type === "numberedListItem" && block.props.start !== undefined
        ? { start: block.props.start }
        : {}),
    },
    content: block.content,
    children: documentBlocks(block.children),
  }));
}
function BasicToolbar() {
  return (
    <FormattingToolbar>
      <BlockTypeSelect />
      <BasicTextStyleButton basicTextStyle="bold" />
      <BasicTextStyleButton basicTextStyle="italic" />
      <CreateLinkButton />
    </FormattingToolbar>
  );
}

export function PageEditor({
  document: content,
  editable,
  onChange,
  onCompositionChange,
}: {
  document: SharedPageDocument;
  editable: boolean;
  onChange?: (document: SharedPageDocument) => void;
  onCompositionChange?: (composing: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const editor = useCreateBlockNote({
    schema,
    dictionary: {
      ...ja,
      placeholders: { ...ja.placeholders, default: "ふたりで残したいことを書いてみよう。" },
    },
    initialContent: content.blocks.length ? content.blocks : undefined,
    domAttributes: {
      editor: { "aria-label": "ページ本文", role: "textbox", "aria-multiline": "true" },
    },
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const preference = document.documentElement.dataset.theme;
      setTheme(
        preference === "dark" || (preference !== "light" && media.matches) ? "dark" : "light",
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    if (!menuOpen || !editable) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      menuButtonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [editable, menuOpen]);

  const insert = (
    type: "paragraph" | "heading" | "bulletListItem" | "numberedListItem" | "checkListItem",
  ) => {
    const last = editor.document.at(-1)!;
    const inserted = editor.insertBlocks([{ type }], last, "after");
    editor.setTextCursorPosition(inserted[0], "start");
    editor.focus();
    setMenuOpen(false);
  };
  return (
    <div
      className="shared-page-editor"
      onCompositionStart={() => onCompositionChange?.(true)}
      onCompositionEnd={() => onCompositionChange?.(false)}
    >
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={theme}
        formattingToolbar={false}
        sideMenu={editable}
        slashMenu={editable}
        onChange={() => {
          if (editable)
            onChange?.({
              format: "blocknote",
              schemaVersion: 1,
              blocks: documentBlocks(editor.document),
            });
        }}
      >
        {editable ? <FormattingToolbarController formattingToolbar={BasicToolbar} /> : null}
      </BlockNoteView>
      {editable ? (
        <div ref={menuRef} className="relative mt-3 px-1">
          <button
            ref={menuButtonRef}
            type="button"
            className="shared-page-icon-button"
            aria-label="ブロックを追加"
            title="ブロックを追加"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div
              id={menuId}
              className="mt-1 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-2 shadow-sm"
              role="group"
              aria-label="追加するブロック"
            >
              {(
                [
                  ["paragraph", "文章"],
                  ["heading", "見出し"],
                  ["bulletListItem", "箇条書き"],
                  ["numberedListItem", "番号付きリスト"],
                  ["checkListItem", "チェックリスト"],
                ] as const
              ).map(([type, label]) => (
                <button
                  type="button"
                  key={type}
                  className="shared-page-text-button"
                  onClick={() => insert(type)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
