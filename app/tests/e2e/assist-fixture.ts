import type { Page } from "@playwright/test";

declare global {
  interface Window {
    assistNativeFixture: { play: () => Promise<void>; stopped: number };
    assistPaintFixture: { framesBeforeTranscribe: number; frames: number; workers: number };
    assistFixture: {
      emit: () => void;
      stopped: number;
      spoken: string[];
      workletLoaded: boolean;
      captureRequests: number;
      activeTracks: number;
      flushes: number;
      holdPermission: boolean;
      allowMicrophone: () => void;
    };
  }
}

/** Inject equal CPU work into main-thread and Worker base64 paths, then count rendered frames. */
export async function installAssistEncodingLoad(page: Page) {
  await page.addInitScript(() => {
    const fixture = { frames: 0, framesBeforeTranscribe: -1, workers: 0 };
    window.assistPaintFixture = fixture;
    const observe = () => {
      if (
        document.querySelector(
          'dialog[data-phase="submitting"] .assist-send[aria-busy="true"] .assist-spinner',
        )
      )
        fixture.frames++;
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
    const nativeBtoa = window.btoa.bind(window);
    window.btoa = (value) => {
      const until = performance.now() + 1000;
      while (performance.now() < until) {
        /* Deliberate fixture CPU load. */
      }
      return nativeBtoa(value);
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes("/api/assist/transcribe"))
        fixture.framesBeforeTranscribe = fixture.frames;
      return nativeFetch(input, init);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (!String(url).includes("audio-encode")) {
          super(url, options);
          return;
        }
        fixture.workers++;
        const source = `
          const nativeBtoa = self.btoa.bind(self);
          self.btoa = value => {
            const until = performance.now() + 1000;
            while (performance.now() < until) {}
            return nativeBtoa(value);
          };
          self.onmessage = async event => {
            await import(${JSON.stringify(String(url))});
            self.onmessage(event);
          };
        `;
        const bootstrap = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        super(bootstrap, options);
        this.addEventListener("message", () => URL.revokeObjectURL(bootstrap), { once: true });
        this.addEventListener("error", () => URL.revokeObjectURL(bootstrap), { once: true });
      }
    };
  });
}

/** Real AudioContext/AudioWorklet; only the microphone is replaced by generated tones. */
export async function installNativeAssistAudioFixture(page: Page) {
  await page.addInitScript(() => {
    let play: () => Promise<void> = async () => {
      throw new Error("Microphone not initialized");
    };
    const fixture = { stopped: 0, play: () => play() };
    window.assistNativeFixture = fixture;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const context = new AudioContext();
        await context.resume();
        const output = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0;
        oscillator.connect(gain).connect(output);
        oscillator.start();
        play = async () => {
          const start = context.currentTime + 0.08;
          for (const [at, until, frequency] of [
            [0, 0.8, 220],
            [1.2, 2.2, 440],
            [2.8, 3.6, 880],
          ]) {
            oscillator.frequency.setValueAtTime(frequency, start + at);
            gain.gain.setValueAtTime(0.22, start + at);
            gain.gain.setValueAtTime(0, start + until);
          }
          await new Promise((resolve) => setTimeout(resolve, 3900));
        };
        const track = output.stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => {
          if (stopped) return;
          stopped = true;
          fixture.stopped++;
          stop();
          oscillator.stop();
          void context.close().catch(() => {});
        };
        return output.stream;
      },
    });
  });
}
/** Browser media only. HTTP fixtures are explicit in the test, never a production mode. */
export async function installAssistMediaFixture(page: Page) {
  await page.addInitScript(() => {
    let receive:
      | ((event: {
          data: Float32Array | { type: "started" } | { type: "finished"; sampleCount: number };
        }) => void)
      | null = null;
    let recording = false;
    let samples = 0;
    let grantMicrophone!: () => void;
    const permission = new Promise<void>((resolve) => {
      grantMicrophone = resolve;
    });
    const fixture = {
      stopped: 0,
      spoken: [] as string[],
      workletLoaded: false,
      captureRequests: 0,
      activeTracks: 0,
      flushes: 0,
      holdPermission: false,
      allowMicrophone() {
        fixture.holdPermission = false;
        grantMicrophone();
      },
      emit() {
        if (!recording) return;
        for (let i = 0; i < 5; i++) {
          samples += 1024;
          receive?.({ data: new Float32Array(1024).fill(0.2) });
        }
        for (let i = 0; i < 17; i++) {
          samples += 1024;
          receive?.({ data: new Float32Array(1024) });
        }
      },
    };
    window.assistFixture = fixture;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        fixture.captureRequests++;
        if (fixture.holdPermission) await permission;
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
          if (message.type === "start") {
            recording = true;
            samples = 0;
            queueMicrotask(() => receive?.({ data: { type: "started" } }));
          }
          if (message.type === "finish") {
            recording = false;
            fixture.flushes++;
            queueMicrotask(() => receive?.({ data: { type: "finished", sampleCount: samples } }));
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
