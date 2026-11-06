import { SharedPageDocumentSchema } from "../../../contracts/shared-pages";
import { draftText, type PageDraft } from "./editSession";

const maxBackupLength = 2_000_000;
export function draftBackupKey(userId: string, teamId: string, pageId: string) {
  return `kaji:shared-page-draft:v1:${userId}:${teamId}:${pageId}`;
}

export function readDraftBackup(key: string): PageDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > maxBackupLength) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("title" in value) ||
      typeof value.title !== "string" ||
      !("document" in value)
    )
      return null;
    const document = SharedPageDocumentSchema.safeParse(value.document);
    if (document.success) return { title: value.title.slice(0, 200), document: document.data };
    // Even invalid/oversized input that could not be saved remains recoverable as
    // plain text. Never execute or render unknown stored blocks or unsafe links.
    if (!("text" in value) || typeof value.text !== "string") return null;
    return {
      title: value.title.slice(0, 200),
      document: {
        format: "blocknote",
        schemaVersion: 1,
        blocks: (value.text.match(/[\s\S]{1,50000}/g) ?? [""]).map((text) => ({
          id: crypto.randomUUID(),
          type: "paragraph",
          props: {},
          content: [{ type: "text", text, styles: {} }],
          children: [],
        })),
      },
    };
  } catch {
    return null;
  }
}

export function writeDraftBackup(key: string, draft: PageDraft): boolean {
  try {
    const raw = JSON.stringify({
      title: draft.title,
      document: draft.document,
      text: draftText(draft),
    });
    if (raw.length > maxBackupLength) return false;
    sessionStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearDraftBackup(key: string): boolean {
  try {
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
