import { afterEach, expect, it, vi } from "vitest";
import { createCapture } from "./capture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("stops tracks from a permission grant that arrives after closing the panel", async () => {
  let grant!: (value: MediaStream) => void;
  const permission = new Promise<MediaStream>((resolve) => {
    grant = resolve;
  });
  const stop = vi.fn(),
    close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn().mockReturnValue(permission) },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    },
  );
  const capture = createCapture({ onRecording: vi.fn(), onAudio: vi.fn(), onStop: vi.fn() });
  capture.stop();
  grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await capture.ready;
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
