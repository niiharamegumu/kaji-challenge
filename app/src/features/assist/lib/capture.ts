import { SpeechDetector } from "./audio";

type Callbacks = {
  onRecording: () => void;
  onAudio: (wav: Uint8Array<ArrayBuffer>) => void;
  onStop: (message: string, reason: "idle" | "error") => void;
};
type AudioResources = {
  context: AudioContext;
  node?: AudioWorkletNode;
  source?: MediaStreamAudioSourceNode;
  mute?: GainNode;
  disposed: boolean;
};
const preparationFailed =
  "音声の準備ができませんでした。閉じて、もう一度アシストを開いてください。";

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
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let audio: AudioResources;
  const disable = () => {
    listening = false;
    detector = undefined;
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
            track.enabled = false;
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
  const send = () => {
    const wav = detector?.finish();
    disable();
    if (wav) callbacks.onAudio(wav);
    else stopWithReason("声を確認できませんでした。もう一度話してください。");
  };
  const prepare = async (current: AudioResources) => {
    const context = current.context;
    await bounded(
      Promise.all([
        context.state === "running" ? Promise.resolve() : context.resume(),
        current.node
          ? Promise.resolve()
          : context.audioWorklet.addModule(
              new URL("./audio-capture.worklet.js?no-inline", import.meta.url),
            ),
      ]),
      5000,
      preparationFailed,
      lifetime.signal,
    );
    lifetime.signal.throwIfAborted();
    if (current.disposed || context.state !== "running" || !stream)
      throw new Error(preparationFailed);
    if (current.node) return;
    current.source = context.createMediaStreamSource(stream);
    current.node = new AudioWorkletNode(context, "assist-capture");
    current.mute = context.createGain();
    current.mute.gain.value = 0;
    current.source.connect(current.node);
    current.node.connect(current.mute);
    current.mute.connect(context.destination);
    current.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (closed || audio !== current || !listening || !detector) return;
      const state = detector.push(event.data);
      if (state === "recording") callbacks.onRecording();
      if (state === "ready") send();
      if (state === "idle") stopWithReason("", "idle");
      if (state === "too_long") stopWithReason("15秒を超えました。短く話し直してください。");
    };
  };
  const prepareWithRecovery = async () => {
    try {
      await prepare(audio);
    } catch {
      lifetime.signal.throwIfAborted();
      disposeAudio(audio);
      audio = openAudio();
      // The same muted MediaStream is attached to a fresh context, at most once.
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
    async listen() {
      if (closed) return;
      try {
        await ready;
        lifetime.signal.throwIfAborted();
        // SpeechSynthesis can interrupt Safari's audio session while input is disabled.
        if (audio.context.state !== "running") await prepareWithRecovery();
        lifetime.signal.throwIfAborted();
        detector = new SpeechDetector(audio.context.sampleRate);
        listening = true;
        stream?.getTracks().forEach((track) => {
          track.enabled = true;
        });
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => stopWithReason("", "idle"), 35_000);
      } catch (error) {
        stop();
        throw error;
      }
    },
  };
}
