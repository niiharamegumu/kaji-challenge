import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PreferencesFixture } from "../../../test/userPreferences";
import { TodoCompletionSettings } from "./TodoCompletionSettings";

afterEach(cleanup);
const select = () => screen.getByRole("combobox", { name: "ToDo完了の取り消し猶予" });
it("shows the default, five whole-second choices and account scope", () => {
  render(
    <PreferencesFixture>
      <TodoCompletionSettings />
    </PreferencesFixture>,
  );
  expect(select()).toHaveValue("3000");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "1秒",
    "2秒",
    "3秒",
    "4秒",
    "5秒",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "取り消し猶予の説明" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/アカウントに自動保存.*別の端末/);
});
it.each([1000, 2000, 3000, 4000, 5000])("sends only the chosen delay %s", (value) => {
  const update = vi.fn();
  render(
    <PreferencesFixture update={update}>
      <TodoCompletionSettings />
    </PreferencesFixture>,
  );
  fireEvent.change(select(), { target: { value: String(value) } });
  expect(update).toHaveBeenCalledWith({ todoCompletionDelayMs: value });
});
it("disables changes until loaded and while saving", () => {
  render(
    <PreferencesFixture writable={false}>
      <TodoCompletionSettings />
    </PreferencesFixture>,
  );
  expect(select()).toBeDisabled();
});
