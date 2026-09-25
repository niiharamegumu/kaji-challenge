import { MutationObserver, onlineManager } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { appQueryClient } from "./queryClient";

afterEach(() => {
  onlineManager.setOnline(true);
  appQueryClient.clear();
});

it("fails offline writes without pausing or automatically replaying them on reconnect", async () => {
  appQueryClient.mount();
  try {
    onlineManager.setOnline(false);
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const mutation = new MutationObserver(appQueryClient, { mutationFn: save });
    const request = mutation.mutate(undefined);
    const result = expect(request).rejects.toThrow("offline");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await result;
    expect(mutation.getCurrentResult()).toMatchObject({ isError: true, isPaused: false });
    onlineManager.setOnline(true);
    await appQueryClient.resumePausedMutations();
    expect(save).toHaveBeenCalledTimes(1);
  } finally {
    appQueryClient.unmount();
  }
});
