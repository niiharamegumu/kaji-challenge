import type { Page } from "@playwright/test";

declare global {
  interface Window {
    assistFixture: { emit: () => void; stopped: number; spoken: string[]; workletLoaded: boolean };
  }
}
/** Browser media only. HTTP fixtures are explicit in the test, never a production mode. */
export async function installAssistMediaFixture(page: Page) {
  await page.addInitScript(() => {
    let receive: ((event: { data: Float32Array }) => void) | null = null;
    const fixture = {
      stopped: 0,
      spoken: [] as string[],
      workletLoaded: false,
      emit() {
        for (let i = 0; i < 5; i++) receive?.({ data: new Float32Array(1024).fill(0.2) });
        for (let i = 0; i < 17; i++) receive?.({ data: new Float32Array(1024) });
      },
    };
    window.assistFixture = fixture;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const track = {
          enabled: true,
          stop() {
            fixture.stopped++;
          },
          addEventListener() {},
        };
        return { getTracks: () => [track] };
      },
    });
    class FixtureContext {
      sampleRate = 16000;
      state = "running";
      destination = {};
      audioWorklet = {
        async addModule(url: string) {
          if (new URL(url).origin !== location.origin)
            throw new Error("Worklet must be a same-origin static asset");
          const response = await fetch(url);
          if (!response.ok || !(await response.text()).includes("registerProcessor"))
            throw new Error("Worklet asset unavailable");
          fixture.workletLoaded = true;
        },
      };
      async resume() {}
      async close() {
        this.state = "closed";
      }
      addEventListener() {}
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createGain() {
        return { gain: { value: 0 }, connect() {}, disconnect() {} };
      }
    }
    class FixtureNode {
      port = {
        get onmessage() {
          return receive;
        },
        set onmessage(callback: typeof receive) {
          receive = callback;
        },
        close() {},
      };
      connect() {}
      disconnect() {}
    }
    class Utterance {
      lang = "";
      voice: unknown;
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    Object.defineProperty(window, "AudioContext", { value: FixtureContext });
    Object.defineProperty(window, "AudioWorkletNode", { value: FixtureNode });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        getVoices: () => [{ name: "Fixture Japanese", lang: "ja-JP", localService: true }],
        addEventListener() {},
        removeEventListener() {},
        cancel() {},
        resume() {},
        speak(utterance: Utterance) {
          fixture.spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(), 20);
        },
      },
    });
  });
}
