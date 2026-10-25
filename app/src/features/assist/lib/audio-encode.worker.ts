import { encodeWav, type CapturedAudio } from "./audio";

// This Worker receives local PCM only and never makes network requests.
self.onmessage = (event: MessageEvent<CapturedAudio>) => {
  const audio = event.data;
  self.postMessage(new Blob([encodeWav(audio.chunks, audio.sampleRate)], { type: "audio/wav" }));
};
