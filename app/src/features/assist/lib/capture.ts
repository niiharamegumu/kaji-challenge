import { SpeechDetector, type CapturedAudio } from "./audio";
import { assistAudio } from "../../../contracts/assist";

type Callbacks = {
  onRecording: () => void;
  onAudio: (audio: CapturedAudio, limited?: boolean) => void;
  onStop: (message: string, reason: "idle" | "error") => void;
};
type AudioResources = {
  context: AudioContext;
  node?: AudioWorkletNode;
  source?: MediaStreamAudioSourceNode;
  mute?: GainNode;
  moduleReady?: Promise<void>;
  disposed: boolean;
};
const preparationFailed =
  "音声の準備ができませんでした。閉じて、もう一度アシストを開いてください。";
type CaptureStatus = { type: "started" } | { type: "finished"; sampleCount: number };

function bounded<T>(promise: Promise<T>, ms: number, message: string, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  return Promise.race([promise, interrupted]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  });
}
function disposeAudio(audio: AudioResources) {
  if (audio.disposed) return;
  audio.disposed = true;
  if (audio.node) {
    audio.node.port.onmessage = null;
    audio.node.disconnect();
    audio.node.port.close();
  }
  audio.source?.disconnect();
  audio.mute?.disconnect();
  if (audio.context.state !== "closed") void audio.context.close().catch(() => {});
}

/** Call directly from a gesture. One microphone grant is reused during bounded audio recovery. */
export function createCapture(callbacks: Callbacks) {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    throw new Error("このブラウザーでは録音できません。HTTPSで開いてください。");
  }
  const lifetime = new AbortController();
  let closed = false,
    listening = false;
  let stream: MediaStream | undefined;
  let detector: SpeechDetector | undefined;
  let receivedSamples = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let finishing = false;
  let finished: ((sampleCount: number) => void) | undefined;
  let started: (() => void) | undefined;
  let starting: Promise<void> | undefined;
  let audio: AudioResources;
  const disable = () => {
    listening = false;
    detector = undefined;
    audio.node?.port.postMessage({ type: "cancel" });
    clearTimeout(idleTimer);
    stream?.getTracks().forEach((track) => {
      track.enabled = false;
    });
  };
  const stop = () => {
    if (closed) return;
    closed = true;
    lifetime.abort();
    disable();
    disposeAudio(audio);
    stream?.getTracks().forEach((track) => track.stop());
  };
  const stopWithReason = (message: string, reason: "idle" | "error" = "error") => {
    if (closed) return;
    stop();
    callbacks.onStop(message, reason);
  };
  const openAudio = (): AudioResources => {
    const current: AudioResources = { context: new AudioContext(), disposed: false };
    try {
      // Unlock inside the gesture. Microphone activation or playback may interrupt it again.
      void current.context.resume().catch(() => {});
      current.context.addEventListener("statechange", () => {
        if (!closed && audio === current && listening && current.context.state !== "running")
          stopWithReason("音声が中断されました。もう一度アシストを開いてください。");
      });
      // Independent of microphone permission; overlap the static module fetch with that wait.
      current.moduleReady = current.context.audioWorklet.addModule(
        new URL("./audio-capture.worklet.js?no-inline", import.meta.url),
      );
      // Permission may still be pending when loading fails. prepare() handles recovery later.
      void current.moduleReady.catch(() => {});
      return current;
    } catch (error) {
      disposeAudio(current);
      throw error;
    }
  };
  audio = openAudio();
  let permission: Promise<MediaStream>;
  try {
    // Request permission before yielding; never request it again for automatic recovery.
    permission = navigator.mediaDevices
      .getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      })
      .then((granted) => {
        if (closed) granted.getTracks().forEach((track) => track.stop());
        else {
          stream = granted;
          stream.getTracks().forEach((track) => {
            // Keep input active during preparation. Discard PCM until listen() starts;
            // disabling the input here can leave Safari's audio session suspended.
            track.enabled = true;
            track.addEventListener("ended", () => {
              if (!closed) stopWithReason("マイクとの接続が切れました。");
            });
          });
        }
        return granted;
      });
  } catch (error) {
    stop();
    throw error;
  }
  const send = async (limited = false) => {
    if (closed || !listening || finishing) return;
    finishing = true;
    clearTimeout(idleTimer);
    try {
      // Port messages are ordered: consume queued PCM and the final partial block first.
      const sampleCount = await bounded(
        new Promise<number>((resolve) => {
          finished = resolve;
          audio.node?.port.postMessage({ type: "finish" });
        }),
        1500,
        "録音を停止できませんでした。もう一度録音してください。",
        lifetime.signal,
      );
      lifetime.signal.throwIfAborted();
      if (!Number.isInteger(sampleCount) || sampleCount < 0 || receivedSamples !== sampleCount) {
        throw new Error("録音の一部を確認できませんでした。もう一度録音してください。");
      }
      const pcm = detector?.pcm();
      if (!pcm) {
        stopWithReason("声を確認できませんでした。もう一度話してください。");
        return;
      }
      stop();
      callbacks.onAudio(pcm, limited);
    } catch (error) {
      if (!closed) stopWithReason(error instanceof Error ? error.message : preparationFailed);
    } finally {
      finished = undefined;
    }
  };
  const prepare = async (current: AudioResources) => {
    const context = current.context;
    if (!stream) throw new Error(preparationFailed);
    if (!current.source) {
      current.source = context.createMediaStreamSource(stream);
      current.mute = context.createGain();
      current.mute.gain.value = 0;
      // Activate the live input graph before awaiting resume. Keep all output silent.
      current.source.connect(current.mute);
      current.mute.connect(context.destination);
    }
    await bounded(
      Promise.all([
        context.state === "running" ? Promise.resolve() : context.resume(),
        current.moduleReady,
      ]),
      5000,
      preparationFailed,
      lifetime.signal,
    );
    lifetime.signal.throwIfAborted();
    if (current.disposed || context.state !== "running" || !stream)
      throw new Error(preparationFailed);
    if (current.node) return;
    current.node = new AudioWorkletNode(context, "assist-capture");
    current.source.disconnect();
    current.source.connect(current.node);
    current.node.connect(current.mute!);
    current.node.port.onmessage = (event: MessageEvent<Float32Array | CaptureStatus>) => {
      if (closed || audio !== current || !listening || !detector) return;
      if (!(event.data instanceof Float32Array)) {
        if (event.data.type === "started") started?.();
        if (event.data.type === "finished") finished?.(event.data.sampleCount);
        return;
      }
      receivedSamples += event.data.length;
      const state = detector.push(event.data);
      if (state === "recording" && !finishing) callbacks.onRecording();
      if (state === "too_long") void send(true);
    };
  };
  const prepareWithRecovery = async () => {
    try {
      await prepare(audio);
    } catch {
      lifetime.signal.throwIfAborted();
      disposeAudio(audio);
      audio = openAudio();
      // The same MediaStream is attached to a fresh context, at most once.
      await prepare(audio);
    }
  };
  const ready = (async () => {
    try {
      await bounded(
        permission,
        20_000,
        "マイクの準備が時間内に終わりませんでした。許可を確認して、もう一度開いてください。",
        lifetime.signal,
      );
      lifetime.signal.throwIfAborted();
      await prepareWithRecovery();
    } catch (error) {
      stop();
      throw error;
    }
  })();
  return {
    ready,
    stop,
    disable,
    send,
    listen() {
      if (starting) return starting;
      if (closed || listening) return Promise.resolve();
      starting = (async () => {
        try {
          await ready;
          lifetime.signal.throwIfAborted();
          // SpeechSynthesis can interrupt Safari's audio session while input is disabled.
          if (audio.context.state !== "running") await prepareWithRecovery();
          lifetime.signal.throwIfAborted();
          detector = new SpeechDetector(audio.context.sampleRate);
          receivedSamples = 0;
          listening = true;
          finishing = false;
          stream?.getTracks().forEach((track) => {
            track.enabled = true;
          });
          clearTimeout(idleTimer);
          await bounded(
            new Promise<void>((resolve) => {
              started = resolve;
              audio.node?.port.postMessage({ type: "start" });
            }),
            5000,
            preparationFailed,
            lifetime.signal,
          );
          lifetime.signal.throwIfAborted();
          idleTimer = setTimeout(() => {
            void send(true);
          }, assistAudio.maxSeconds * 1000);
        } catch (error) {
          stop();
          throw error;
        }
      })().finally(() => {
        starting = undefined;
        started = undefined;
      });
      return starting;
    },
  };
}
