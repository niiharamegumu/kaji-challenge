import type { Page } from "@playwright/test";

declare global {
  interface Window {
    assistFixture: {
      emit: () => void;
      stopped: number;
      spoken: string[];
      workletLoaded: boolean;
      captureRequests: number;
      activeTracks: number;
      flushes: number;
    };
  }
}
/** Browser media only. HTTP fixtures are explicit in the test, never a production mode. */
export async function installAssistMediaFixture(page: Page) {
  await page.addInitScript(() => {
    let receive: ((event: { data: Float32Array | { type: "finished" } }) => void) | null = null;
    let recording = false;
    const fixture = {
      stopped: 0,
      spoken: [] as string[],
      workletLoaded: false,
      captureRequests: 0,
      activeTracks: 0,
      flushes: 0,
      emit() {
        if (!recording) return;
        for (let i = 0; i < 5; i++) receive?.({ data: new Float32Array(1024).fill(0.2) });
        for (let i = 0; i < 17; i++) receive?.({ data: new Float32Array(1024) });
      },
    };
    window.assistFixture = fixture;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        fixture.captureRequests++;
        fixture.activeTracks++;
        const track = {
          enabled: true,
          stop() {
            fixture.stopped++;
            fixture.activeTracks--;
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
        postMessage(message: { type: string }) {
          if (message.type === "start") recording = true;
          if (message.type === "finish") {
            recording = false;
            fixture.flushes++;
            queueMicrotask(() => receive?.({ data: { type: "finished" } }));
          }
        },
        close() {
          recording = false;
        },
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
          if (fixture.activeTracks !== 0)
            throw new Error("Do not start playback with a live microphone");
          fixture.spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(), 20);
        },
      },
    });
  });
}
