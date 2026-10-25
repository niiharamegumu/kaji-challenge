import { assistAudio } from "../../contracts/assist";
import { AppError } from "../domain/errors";

/** Accept only our bounded canonical WAV; do not trust MIME or client duration. */
export function validateAssistAudio(audio: string | Uint8Array) {
  const invalid = () =>
    new AppError(400, "invalid_audio", "音声形式を確認できません。録音し直してください。");
  let bytes: Uint8Array;
  try {
    bytes =
      typeof audio === "string"
        ? Uint8Array.from(atob(audio), (char) => char.charCodeAt(0))
        : audio;
  } catch {
    throw invalid();
  }
  if (bytes.length < 44 + 3200 || bytes.length > assistAudio.maxBytes) throw invalid();
  const header = String.fromCharCode(...bytes.subarray(0, 44));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    header.slice(0, 4) !== "RIFF" ||
    header.slice(8, 16) !== "WAVEfmt " ||
    header.slice(36, 40) !== "data" ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== assistAudio.sampleRate ||
    view.getUint32(28, true) !== assistAudio.sampleRate * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== bytes.length - 44 ||
    (bytes.length - 44) % 2 !== 0
  )
    throw invalid();
  // Evaluate 20 ms frames: long pauses must not dilute a short, quiet utterance.
  // Require 180 ms of signal so silence and isolated clicks cannot trigger inference.
  let signalSamples = 0;
  const frameBytes = (assistAudio.sampleRate / 50) * 2;
  const threshold = (0.002 * 32768) ** 2;
  for (let offset = 44; offset < bytes.length; offset += frameBytes) {
    const end = Math.min(offset + frameBytes, bytes.length);
    let energy = 0;
    for (let i = offset; i < end; i += 2) energy += view.getInt16(i, true) ** 2;
    const count = (end - offset) / 2;
    if (energy >= threshold * count) signalSamples += count;
    if (signalSamples >= assistAudio.sampleRate * 0.18) return;
  }
  throw new AppError(422, "silent_audio", "声を確認できませんでした。もう一度話してください。");
}
