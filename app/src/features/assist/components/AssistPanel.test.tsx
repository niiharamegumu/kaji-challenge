import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssistResult } from "../../../contracts/assist";
import { VoiceSession } from "../model/VoiceSession";
import { AssistPanel } from "./AssistPanel";

const dialogMethods = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype);
beforeEach(() => {
  for (const method of ["showModal", "close"] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const method of ["showModal", "close"]) {
    if (dialogMethods[method])
      Object.defineProperty(HTMLDialogElement.prototype, method, dialogMethods[method]);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  }
});
const items = [
  { id: "milk", name: "牛乳", notes: "低脂肪の1Lを2本\nなければ買わない" },
  { id: "eggs", name: "卵", notes: "10個入り" },
  { id: "bread", name: "パン", notes: null },
].map((item) => ({
  ...item,
  teamId: "team",
  categoryId: null,
  sortKey: 100,
  createdAt: "2026-10-30T00:00:00Z",
  updatedAt: "2026-10-30T00:00:00Z",
}));
function show(result: AssistResult) {
  const session = new VoiceSession("team", vi.fn(), vi.fn());
  render(
    <AssistPanel
      session={session}
      state={{
        open: true,
        phase: "done",
        transcript: "",
        submittedTranscript: "買い物に追加して",
        result,
        message: "",
      }}
    />,
  );
}
it.each(["added", "listed", "batch"] as const)(
  "shows the saved title and notes together for %s results",
  (kind) => {
    const common = { transcript: "買い物に追加して", replyText: "3件です。" };
    show(
      kind === "batch"
        ? {
            ...common,
            kind,
            results: [
              { ...common, kind: "removed", action: "complete", count: 1 },
              { ...common, kind: "added", items },
            ],
          }
        : kind === "listed"
          ? { ...common, kind, items, total: 3 }
          : { ...common, kind, items },
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("牛乳")).toBeVisible();
    expect(within(rows[0]).getByText("低脂肪の1Lを2本 なければ買わない")).toBeVisible();
    expect(within(rows[1]).getByText("10個入り")).toBeVisible();
    expect(rows[2]).toHaveTextContent(/^パン$/);
  },
);
it("renders note content as text without interpreting HTML", () => {
  const notes = '<img src=x onerror="alert(1)">';
  show({
    kind: "added",
    transcript: "追加して",
    replyText: "追加しました。",
    items: [{ ...items[0], notes }],
  });
  expect(screen.getByText(notes)).toBeVisible();
  expect(screen.queryByRole("img")).toBeNull();
});
