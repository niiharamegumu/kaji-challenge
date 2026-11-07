import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageDraft } from "./editSession";
import { draftText, PageEditSession } from "./editSession";
import {
  clearDraftBackup,
  draftBackupKey,
  readDraftBackup,
  syncDraftBackup,
  writeDraftBackup,
} from "./draftBackup";

vi.mock("../api/sharedPagesApi", () => ({ sharedPagesApi: {} }));

const key = draftBackupKey("user-one", "team-one", "page-one");
const draft = (): PageDraft => ({
  title: "未保存の京都旅行",
  document: {
    format: "blocknote",
    schemaVersion: 1,
    blocks: [
      {
        id: "check",
        type: "checkListItem",
        props: { checked: true },
        content: [{ type: "text", text: "宿を予約する", styles: { bold: true } }],
        children: [],
      },
    ],
  },
});
beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

it("roundtrips unsaved title, block formatting and checkbox state through tab storage", () => {
  const input = draft();
  expect(writeDraftBackup(key, input)).toBe(true);
  expect(readDraftBackup(key)).toEqual(input);
  expect(sessionStorage.getItem(key)).toContain("☑ 宿を予約する");
});

it("separates users, teams, pages and new-page drafts", () => {
  const keys = [
    key,
    draftBackupKey("user-two", "team-one", "page-one"),
    draftBackupKey("user-one", "team-two", "page-one"),
    draftBackupKey("user-one", "team-one", "page-two"),
    draftBackupKey("user-one", "team-one", "new"),
  ];
  expect(new Set(keys).size).toBe(keys.length);
  writeDraftBackup(key, draft());
  for (const other of keys.slice(1)) expect(readDraftBackup(other)).toBeNull();
});

it("stores only the document and readable backup, never ownership or pending request state", () => {
  const input = Object.assign(draft(), {
    lease: { expiresAt: "2026-11-06T12:01:30.000Z" },
    userId: "editor-user",
    expectedVersion: 99,
  });
  writeDraftBackup(key, input);
  const raw = sessionStorage.getItem(key)!;
  expect(raw).not.toContain("expiresAt");
  expect(raw).not.toContain("editor-user");
  expect(raw).not.toContain("expectedVersion");
  expect(Object.keys(JSON.parse(raw))).toEqual(["title", "document", "text"]);
});

it("keeps blank titles and new empty documents recoverable", () => {
  const blank: PageDraft = {
    title: "",
    document: { format: "blocknote", schemaVersion: 1, blocks: [] },
  };
  writeDraftBackup(key, blank);
  expect(readDraftBackup(key)).toEqual(blank);
});

it.each(["broken JSON", "null", "[]", '{"title":4}', '{"title":"x","document":{}}'])(
  "ignores malformed stored payload %s",
  (raw) => {
    sessionStorage.setItem(key, raw);
    expect(readDraftBackup(key)).toBeNull();
  },
);

it("recovers unsupported versions and unsafe links only as non-executable plain text", () => {
  const unsafe = {
    title: "保存できなかった文書",
    document: {
      format: "blocknote",
      schemaVersion: 9,
      blocks: [{ type: "html", html: "<script>alert(1)</script>" }],
    },
    text: "本文とリンク javascript:alert(1) を手動で確認する",
    userId: "not-restored",
  };
  sessionStorage.setItem(key, JSON.stringify(unsafe));
  const restored = readDraftBackup(key)!;
  expect(restored.title).toBe(unsafe.title);
  expect(restored.document).toMatchObject({
    format: "blocknote",
    schemaVersion: 1,
    blocks: [{ type: "paragraph", content: [{ type: "text", text: unsafe.text, styles: {} }] }],
  });
  expect(restored.document.blocks[0].content[0].type).toBe("text");
  expect(JSON.stringify(restored)).not.toContain("not-restored");
});

it("preserves oversized unsaved writing as copyable chunks when the save schema rejects it", () => {
  const input = draft();
  const text = "あ".repeat(90_000);
  input.document.blocks[0].content = [{ type: "text", text, styles: {} }];
  expect(writeDraftBackup(key, input)).toBe(true);
  const restored = readDraftBackup(key)!;
  expect(restored.document.blocks.length).toBeGreaterThan(1);
  expect(draftText(restored).replaceAll("\n", "")).toContain(text);
});

it("clears only the selected draft after saving or explicit discard", () => {
  const other = draftBackupKey("user-one", "team-one", "page-two");
  writeDraftBackup(key, draft());
  writeDraftBackup(other, draft());
  expect(clearDraftBackup(key)).toBe(true);
  expect(readDraftBackup(key)).toBeNull();
  expect(readDraftBackup(other)).toEqual(draft());
});

it("reports storage write and delete errors without throwing or destroying the previous backup", () => {
  writeDraftBackup(key, draft());
  const prior = sessionStorage.getItem(key);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  expect(writeDraftBackup(key, { ...draft(), title: "new input" })).toBe(false);
  expect(sessionStorage.getItem(key)).toBe(prior);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  expect(clearDraftBackup(key)).toBe(false);
  expect(sessionStorage.getItem(key)).toBe(prior);
});

it("ignores inaccessible or oversized storage and reports an oversized write as failure", () => {
  sessionStorage.setItem(key, "x".repeat(2_000_001));
  expect(readDraftBackup(key)).toBeNull();
  expect(writeDraftBackup(key, { ...draft(), title: "x".repeat(2_000_001) })).toBe(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  expect(readDraftBackup(key)).toBeNull();
});

it("keeps the latest typing on pagehide and never restores a discarded pending checkpoint", () => {
  vi.useFakeTimers();
  const session = new PageEditSession(true, vi.fn());
  const stop = syncDraftBackup(key, session, vi.fn());
  try {
    session.change(draft());
    expect(readDraftBackup(key)).toEqual(draft());
    session.changeTitle("次の一文字");
    session.changeTitle("画面を閉じる直前の全文");
    window.dispatchEvent(new Event("pagehide"));
    expect(readDraftBackup(key)?.title).toBe("画面を閉じる直前の全文");

    session.changeTitle("破棄する変更");
    session.discard();
    vi.runAllTimers();
    expect(readDraftBackup(key)).toBeNull();
  } finally {
    stop();
  }
});

it("checkpoints continuous typing before autosave and flushes when switching sessions", () => {
  vi.useFakeTimers();
  const session = new PageEditSession(true, vi.fn());
  const stop = syncDraftBackup(key, session, vi.fn());
  try {
    session.change(draft());
    for (let i = 1; i <= 6; i++) {
      session.changeTitle("連続入力" + i);
      vi.advanceTimersByTime(50);
    }
    expect(readDraftBackup(key)?.title).toMatch(/^連続入力[1-6]$/);
  } finally {
    stop();
  }
  expect(readDraftBackup(key)?.title).toBe("連続入力6");
});

it("bounds synchronous retries when storage is full and checkpoints the latest input once it recovers", () => {
  vi.useFakeTimers();
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  const session = new PageEditSession(true, vi.fn());
  const notify = vi.fn();
  const stop = syncDraftBackup(key, session, notify);
  try {
    session.change(draft());
    expect(notify).toHaveBeenLastCalledWith(false);
    for (const title of ["続", "続け", "続けて編集"]) session.changeTitle(title);
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(readDraftBackup(key)?.title).toBe("続けて編集");
    expect(notify).toHaveBeenLastCalledWith(true);
  } finally {
    stop();
  }
});
