export function localJapaneseVoice() {
  return typeof speechSynthesis === "undefined"
    ? undefined
    : speechSynthesis
        .getVoices()
        .find((voice) => voice.localService && /^ja(?:-|$)/i.test(voice.lang));
}

/** Explicitly local voice only. Never silently send a ToDo to a remote voice service. */
export function speakReply(text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const voice = localJapaneseVoice();
    if (!voice || typeof SpeechSynthesisUtterance === "undefined") {
      reject(
        new Error(
          "日本語の読み上げ音声が見つかりません。端末の設定で日本語音声を追加してください。",
        ),
      );
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.voice = voice;
    utterance.rate = 1.05;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error("返事を読み上げられませんでした。内容は画面で確認できます。"));
      speechSynthesis.cancel();
    }, 20_000);
    const abort = () => {
      finish(new Error("音声を停止しました。"));
      speechSynthesis.cancel();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      utterance.onend = null;
      utterance.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    utterance.onend = () => finish();
    utterance.onerror = () =>
      finish(new Error("返事を読み上げられませんでした。内容は画面で確認できます。"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    speechSynthesis.cancel();
    speechSynthesis.resume();
    speechSynthesis.speak(utterance);
  });
}
