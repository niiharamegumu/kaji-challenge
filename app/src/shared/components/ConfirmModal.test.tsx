import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmModal } from "./ConfirmModal";

afterEach(cleanup);

it("keeps the existing cancel and confirm actions when optional props are omitted", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const props = {
    isOpen: true,
    title: "月を締めますか？",
    message: "この月の集計を確定します。",
    confirmLabel: "締める",
    onCancel,
    onConfirm,
  };
  const { rerender } = render(<ConfirmModal {...props} />, { wrapper: Provider });
  const user = userEvent.setup();
  const dialog = screen.getByRole("dialog", { name: props.title });
  expect(dialog).toHaveTextContent(props.message);
  const cancel = within(dialog).getByRole("button", { name: "キャンセル" });
  expect(cancel).toHaveFocus();
  await user.click(cancel);
  await user.click(within(dialog).getByRole("button", { name: "締める" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  rerender(<ConfirmModal {...props} isOpen={false} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("allows copying and returning to editing while discarding is disabled", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const onCopy = vi.fn();
  const props = {
    isOpen: true,
    title: "保存していない変更があります",
    message: "通信の結果を確認しています。",
    cancelLabel: "編集を続ける",
    confirmLabel: "変更を破棄して戻る",
    confirmDisabled: true,
    onCancel,
    onConfirm,
    children: (
      <button type="button" onClick={onCopy}>
        入力をコピー
      </button>
    ),
  };
  const { rerender } = render(<ConfirmModal {...props} />, { wrapper: Provider });
  const user = userEvent.setup();
  const dialog = screen.getByRole("dialog", { name: props.title });
  const discard = within(dialog).getByRole("button", { name: props.confirmLabel });
  expect(discard).toBeDisabled();
  await user.click(discard);
  expect(onConfirm).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "入力をコピー" }));
  expect(onCopy).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(1);
  await user.click(within(dialog).getByRole("button", { name: props.cancelLabel }));
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(onConfirm).not.toHaveBeenCalled();
  rerender(<ConfirmModal {...props} confirmDisabled={false} />);
  await user.click(screen.getByRole("button", { name: props.confirmLabel }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
