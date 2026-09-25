import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FormSheet } from "./FormSheet";

it("shows saving immediately, blocks duplicate submission, and retains the draft after failure", async () => {
  let reject!: (error: Error) => void;
  const submit = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
    )
    .mockResolvedValueOnce(undefined);
  const onClose = vi.fn();
  function Form() {
    const mutation = useMutation({ mutationFn: () => submit() as Promise<void> });
    return (
      <FormSheet
        isOpen
        title="追加"
        submitLabel="保存"
        onClose={onClose}
        isSubmitting={mutation.isPending}
        submitFailed={mutation.isError}
        onSubmit={() => mutation.mutateAsync()}
      >
        <label>
          名前
          <input defaultValue="入力済み" />
        </label>
      </FormSheet>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Form />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "保存" }));
  const button = screen.getByRole("button", { name: "保存中…" });
  expect(button).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "名前" })).toBeDisabled();
  await user.click(button);
  await user.click(screen.getByRole("button", { name: "閉じる" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error("offline"));
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
  expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("入力済み");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(submit).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

afterEach(cleanup);
