import { encodeWav, wavBase64, type CapturedAudio } from "./audio";

// This Worker receives local PCM only and never makes network requests.
self.onmessage = (event: MessageEvent<CapturedAudio>) => {
  const audio = event.data;
  self.postMessage(wavBase64(encodeWav(audio.chunks, audio.sampleRate)));
};
