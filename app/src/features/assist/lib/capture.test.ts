import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCapture } from "./capture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class AudioContextFixture {
  state = "running";
  sampleRate = 48_000;
  destination = {};
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockImplementation(async () => {
    this.state = "closed";
  });
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  source = { connect: vi.fn(), disconnect: vi.fn() };
  gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  createMediaStreamSource = vi.fn(() => this.source);
  createGain = vi.fn(() => this.gain);
  stateChanged?: () => void;
  addEventListener = vi.fn((_event: string, changed: () => void) => {
    this.stateChanged = changed;
  });
}
const captures: ReturnType<typeof createCapture>[] = [];
function setup(configure?: (context: AudioContextFixture, index: number) => void) {
  const contexts: AudioContextFixture[] = [];
  const nodes: {
    port: {
      onmessage: unknown;
      close: ReturnType<typeof vi.fn>;
      postMessage: ReturnType<typeof vi.fn>;
    };
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const track = { enabled: true, stop: vi.fn(), addEventListener: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    "AudioContext",
    class extends AudioContextFixture {
      constructor() {
        super();
        configure?.(this, contexts.length);
        contexts.push(this);
      }
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port: {
        onmessage: ((event: { data: Float32Array | { type: "finished" } }) => void) | null;
        close: ReturnType<typeof vi.fn>;
        postMessage: ReturnType<typeof vi.fn>;
      } = {
        onmessage: null,
        close: vi.fn(),
        postMessage: vi.fn((message) => {
          if (message.type === "finish")
            queueMicrotask(() => this.port.onmessage?.({ data: { type: "finished" } }));
        }),
      };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        nodes.push(this);
      }
    },
  );
  const callbacks = { onRecording: vi.fn(), onAudio: vi.fn(), onStop: vi.fn() };
  const start = () => {
    const capture = createCapture(callbacks);
    captures.push(capture);
    return capture;
  };
  return { contexts, nodes, track, stream, getUserMedia, callbacks, start };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  captures.splice(0).forEach((capture) => capture.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("stops tracks from a permission grant that arrives after closing the panel", async () => {
  const fixture = setup();
  const permission = deferred<MediaStream>();
  fixture.getUserMedia.mockReturnValue(permission.promise);
  const capture = fixture.start();
  const failed = vi.fn();
  void capture.ready.catch(failed);
  capture.stop();
  permission.resolve(fixture.stream);
  await vi.advanceTimersByTimeAsync(0);
  expect(failed).toHaveBeenCalled();
  expect(fixture.track.stop).toHaveBeenCalledOnce();
  expect(fixture.contexts[0].close).toHaveBeenCalledOnce();
  expect(fixture.nodes).toHaveLength(0);
});

it("bounds pending permission, releases late tracks, and can start a fresh session", async () => {
  const fixture = setup();
  const permission = deferred<MediaStream>();
  fixture.getUserMedia.mockReturnValueOnce(permission.promise);
  const capture = fixture.start();
  const failed = vi.fn();
  void capture.ready.catch(failed);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(failed).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining("マイク") }),
  );
  expect(fixture.contexts[0].close).toHaveBeenCalledOnce();
  const nextTrack = { ...fixture.track, stop: vi.fn() };
  fixture.getUserMedia.mockResolvedValueOnce({ getTracks: () => [nextTrack] });
  const restarted = fixture.start();
  await restarted.ready;
  await restarted.listen();
  permission.resolve(fixture.stream);
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.track.stop).toHaveBeenCalledOnce();
  expect(nextTrack.enabled).toBe(true);
  expect(nextTrack.stop).not.toHaveBeenCalled();
});

it.each(["resume", "worklet"] as const)(
  "recreates stalled %s once without requesting the microphone again",
  async (stage) => {
    const late = deferred<void>();
    const fixture = setup((context, index) => {
      if (index !== 0) return;
      if (stage === "resume") {
        context.state = "suspended";
        context.resume.mockReturnValue(late.promise);
      } else context.audioWorklet.addModule.mockReturnValue(late.promise);
    });
    const capture = fixture.start();
    const ready = vi.fn();
    void capture.ready.then(ready);
    await vi.advanceTimersByTimeAsync(5000);
    expect(ready).toHaveBeenCalledOnce();
    expect(fixture.contexts).toHaveLength(2);
    expect(fixture.contexts[0].close).toHaveBeenCalledOnce();
    expect(fixture.getUserMedia).toHaveBeenCalledOnce();
    expect(fixture.track.stop).not.toHaveBeenCalled();
    late.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.contexts[0].createMediaStreamSource).not.toHaveBeenCalled();
    await capture.listen();
    expect(fixture.track.enabled).toBe(true);
  },
);

it("stops after the second audio initialization timeout and releases every resource", async () => {
  const fixture = setup((context) => {
    context.state = "suspended";
    context.resume.mockReturnValue(new Promise(() => {}));
  });
  const capture = fixture.start();
  const failed = vi.fn();
  void capture.ready.catch(failed);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(failed).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining("もう一度") }),
  );
  expect(fixture.contexts).toHaveLength(2);
  fixture.contexts.forEach((context) => expect(context.close).toHaveBeenCalledOnce());
  expect(fixture.track.stop).toHaveBeenCalledOnce();
  expect(fixture.track.enabled).toBe(false);
  expect(fixture.callbacks.onAudio).not.toHaveBeenCalled();
});

it("does not retry denied microphone permission", async () => {
  const fixture = setup();
  const denied = new DOMException("denied", "NotAllowedError");
  fixture.getUserMedia.mockRejectedValue(denied);
  await expect(fixture.start().ready).rejects.toBe(denied);
  expect(fixture.getUserMedia).toHaveBeenCalledOnce();
  expect(fixture.contexts).toHaveLength(1);
  expect(fixture.contexts[0].close).toHaveBeenCalledOnce();
});

it("keeps the granted track live while resuming the audio graph, then releases it on stop", async () => {
  const fixture = setup((context) => {
    context.state = "suspended";
    context.resume.mockImplementation(async () => {
      // A disabled input can leave Safari's audio session inactive.
      if (context.resume.mock.calls.length > 1 && fixture.track.enabled) context.state = "running";
    });
  });
  const capture = fixture.start();
  await capture.ready;
  await capture.listen();
  expect(fixture.track.enabled).toBe(true);
  capture.stop();
  expect(fixture.track.stop).toHaveBeenCalledOnce();
});

it("ignores a late worklet load and never retries after closing", async () => {
  const module = deferred<void>();
  const fixture = setup((context) =>
    context.audioWorklet.addModule.mockReturnValue(module.promise),
  );
  const capture = fixture.start();
  const failed = vi.fn();
  void capture.ready.catch(failed);
  await vi.advanceTimersByTimeAsync(0);
  capture.stop();
  module.resolve();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(failed).toHaveBeenCalled();
  expect(fixture.contexts).toHaveLength(1);
  expect(fixture.nodes).toHaveLength(0);
  expect(fixture.track.stop).toHaveBeenCalledOnce();
});

it("resumes audio interrupted during a reply before enabling the microphone", async () => {
  const fixture = setup();
  const capture = fixture.start();
  await capture.ready;
  await capture.listen();
  capture.disable();
  const context = fixture.contexts[0];
  context.state = "suspended";
  context.stateChanged?.();
  expect(fixture.callbacks.onStop).not.toHaveBeenCalled();
  const resumed = deferred<void>();
  context.resume.mockImplementation(() =>
    resumed.promise.then(() => {
      context.state = "running";
    }),
  );
  const listening = capture.listen();
  expect(fixture.track.enabled).toBe(false);
  resumed.resolve();
  await listening;
  expect(fixture.track.enabled).toBe(true);
});

it("closes a pending listening recovery and ignores its late completion", async () => {
  const fixture = setup();
  const capture = fixture.start();
  await capture.ready;
  const resumed = deferred<void>();
  fixture.contexts[0].state = "suspended";
  fixture.contexts[0].resume.mockReturnValue(resumed.promise);
  const failed = vi.fn();
  void capture.listen().catch(failed);
  await vi.advanceTimersByTimeAsync(0);
  capture.stop();
  resumed.resolve();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(failed).toHaveBeenCalled();
  expect(fixture.contexts).toHaveLength(1);
  expect(fixture.track.enabled).toBe(false);
  expect(fixture.track.stop).toHaveBeenCalledOnce();
});

it("does not finish at silence, flushes the tail on explicit stop, and releases the microphone once", async () => {
  const fixture = setup();
  const capture = fixture.start();
  await capture.ready;
  await capture.listen();
  const receive = fixture.nodes[0].port.onmessage as (event: {
    data: Float32Array | { type: "finished" };
  }) => void;
  receive({ data: new Float32Array(48000).fill(0.2) });
  receive({ data: new Float32Array(48000 * 8) });
  expect(fixture.callbacks.onAudio).not.toHaveBeenCalled();
  const final = new Float32Array(9600).fill(0.3);
  fixture.nodes[0].port.postMessage.mockImplementation((message) => {
    if (message.type === "finish") {
      receive({ data: final });
      receive({ data: { type: "finished" } });
    }
  });
  await capture.send();
  await capture.send();
  expect(fixture.callbacks.onAudio).toHaveBeenCalledOnce();
  expect(fixture.callbacks.onAudio.mock.calls[0][0].length).toBe(44 + 16000 * 9.2 * 2);
  expect(fixture.track.stop).toHaveBeenCalledOnce();
  expect(fixture.nodes[0].port.postMessage).toHaveBeenCalledWith({ type: "finish" });
});
it("bounds a missing flush acknowledgement without sending incomplete audio", async () => {
  const fixture = setup();
  const capture = fixture.start();
  await capture.ready;
  await capture.listen();
  fixture.nodes[0].port.postMessage.mockImplementation(() => {});
  const stopping = capture.send();
  await vi.advanceTimersByTimeAsync(1500);
  await stopping;
  expect(fixture.callbacks.onAudio).not.toHaveBeenCalled();
  expect(fixture.callbacks.onStop).toHaveBeenCalledWith(
    expect.stringContaining("停止できません"),
    "error",
  );
  expect(fixture.track.stop).toHaveBeenCalledOnce();
});
