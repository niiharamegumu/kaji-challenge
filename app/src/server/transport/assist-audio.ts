import { assistAudio } from "../../contracts/assist";
import { AppError } from "../domain/errors";

/** Accept only our bounded canonical WAV; do not trust MIME or client duration. */
export function validateAssistAudio(base64: string) {
  const invalid = () =>
    new AppError(400, "invalid_audio", "音声形式を確認できません。録音し直してください。");
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw invalid();
  }
  if (
    binary.length < 44 + 3200 ||
    binary.length > 44 + assistAudio.sampleRate * 2 * assistAudio.maxSeconds
  )
    throw invalid();
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (
    binary.slice(0, 4) !== "RIFF" ||
    binary.slice(8, 16) !== "WAVEfmt " ||
    binary.slice(36, 40) !== "data" ||
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
  // Digital silence is never sent for inference, including a crafted client request.
  let energy = 0;
  for (let i = 44; i < bytes.length; i += 2) energy += (view.getInt16(i, true) / 32768) ** 2;
  if (Math.sqrt(energy / ((bytes.length - 44) / 2)) < 0.002)
    throw new AppError(422, "silent_audio", "声を確認できませんでした。もう一度話してください。");
}
