import { useSyncExternalStore } from "react";
import { localJapaneseVoice } from "../lib/speech";

const subscribe = (changed: () => void) => {
  if (typeof speechSynthesis === "undefined") return () => {};
  speechSynthesis.addEventListener("voiceschanged", changed);
  // Some browsers populate the list only after getVoices has been called once.
  speechSynthesis.getVoices();
  return () => speechSynthesis.removeEventListener("voiceschanged", changed);
};
const snapshot = () => localJapaneseVoice()?.name ?? "";
export function useLocalVoice() {
  return useSyncExternalStore(subscribe, snapshot, () => "");
}
