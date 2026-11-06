import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

afterEach(cleanup);

it("keeps deletion and cancellation available when isDeleting is omitted", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <DeleteConfirmModal
      isOpen
      title="ページを削除しますか？"
      message="この操作は取り消せません。"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
    { wrapper: Provider },
  );
  const user = userEvent.setup();
  const dialog = screen.getByRole("dialog", { name: "ページを削除しますか？" });
  expect(dialog).toHaveTextContent("この操作は取り消せません。");
  await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
  await user.click(within(dialog).getByRole("button", { name: "削除する" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("blocks duplicate deletion and cancellation until the pending deletion ends", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const props = {
    isOpen: true,
    title: "ページを削除しますか？",
    message: "この操作は取り消せません。",
    onCancel,
    onConfirm,
  };
  const { rerender } = render(<DeleteConfirmModal {...props} />, { wrapper: Provider });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "削除する" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  rerender(<DeleteConfirmModal {...props} isDeleting />);
  const pending = screen.getByRole("button", { name: "削除中…" });
  const cancel = screen.getByRole("button", { name: "キャンセル" });
  expect(pending).toBeDisabled();
  expect(pending).toHaveAttribute("aria-busy", "true");
  expect(cancel).toBeDisabled();
  await user.click(pending);
  await user.click(cancel);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
  rerender(<DeleteConfirmModal {...props} isDeleting={false} />);
  await user.click(screen.getByRole("button", { name: "削除する" }));
  await user.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(onConfirm).toHaveBeenCalledTimes(2);
  expect(onCancel).toHaveBeenCalledTimes(1);
});
