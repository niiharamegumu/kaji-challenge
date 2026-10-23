import { SpeechDetector } from "./audio";

type Callbacks = {
  onRecording: () => void;
  onAudio: (wav: Uint8Array<ArrayBuffer>) => void;
  onStop: (message: string, reason: "idle" | "error") => void;
};

/** Call directly from a gesture. stop() also handles a late permission grant. */
export function createCapture(callbacks: Callbacks) {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    throw new Error("このブラウザーでは録音できません。HTTPSで開いてください。");
  }
  const context = new AudioContext();
  const resumed = context.resume();
  // Request permission before yielding to any asynchronous module loading.
  const permission = navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  let closed = false,
    listening = false;
  let stream: MediaStream | undefined;
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let detector: SpeechDetector | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const disable = () => {
    listening = false;
    detector = undefined;
    clearTimeout(idleTimer);
    stream?.getTracks().forEach((track) => {
      track.enabled = false;
    });
  };
  const stop = () => {
    closed = true;
    disable();
    if (node) {
      node.port.onmessage = null;
      node.disconnect();
      node.port.close();
    }
    source?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context.state !== "closed") void context.close().catch(() => {});
  };
  const stopWithReason = (message: string, reason: "idle" | "error" = "error") => {
    stop();
    callbacks.onStop(message, reason);
  };
  const send = () => {
    const wav = detector?.finish();
    disable();
    if (wav) callbacks.onAudio(wav);
    else stopWithReason("声を確認できませんでした。もう一度話してください。");
  };
  const ready = (async () => {
    try {
      stream = await permission;
      if (closed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.getTracks().forEach((track) => {
        track.enabled = false;
        track.addEventListener("ended", () => {
          if (!closed) stopWithReason("マイクとの接続が切れました。");
        });
      });
      await resumed;
      await context.audioWorklet.addModule(
        new URL("./audio-capture.worklet.js?no-inline", import.meta.url),
      );
      if (closed) return;
      source = context.createMediaStreamSource(stream);
      node = new AudioWorkletNode(context, "assist-capture");
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(context.destination);
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (closed || !listening || !detector) return;
        const state = detector.push(event.data);
        if (state === "recording") callbacks.onRecording();
        if (state === "ready") send();
        if (state === "idle") stopWithReason("", "idle");
        if (state === "too_long") stopWithReason("15秒を超えました。短く話し直してください。");
      };
      context.addEventListener("statechange", () => {
        if (!closed && context.state !== "running")
          stopWithReason("音声が中断されました。もう一度アシストを開いてください。");
      });
    } catch (error) {
      stop();
      throw error;
    }
  })();
  // Observe a resume rejection even while the permission dialog remains open.
  void resumed.catch(() => {});
  return {
    ready,
    stop,
    disable,
    send,
    listen() {
      if (closed || !stream || !node) return;
      detector = new SpeechDetector(context.sampleRate);
      listening = true;
      stream.getTracks().forEach((track) => {
        track.enabled = true;
      });
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stopWithReason("", "idle"), 35_000);
    },
  };
}
