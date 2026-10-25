import { expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import source from "./audio-capture.worklet.js?raw";

it("keeps silent pauses and flushes the partial PCM block in port order", () => {
  const postMessage = vi.fn();
  let Processor!: new () => {
    port: { onmessage: (event: { data: { type: string } }) => void };
    process: (inputs: Float32Array[][]) => boolean;
  };
  runInNewContext(source, {
    Float32Array,
    AudioWorkletProcessor: class {
      port = { postMessage, onmessage: null };
    },
    registerProcessor: (_name: string, ctor: typeof Processor) => {
      Processor = ctor;
    },
  });
  const worklet = new Processor();
  worklet.process([[new Float32Array(2048).fill(0.8)]]);
  expect(postMessage).not.toHaveBeenCalled();
  worklet.port.onmessage({ data: { type: "start" } });
  worklet.process([]);
  expect(postMessage).not.toHaveBeenCalled();
  worklet.process([[new Float32Array(1024).fill(0.2)]]);
  worklet.process([[new Float32Array(128)]]);
  // A repeated start must not erase the already captured partial block.
  worklet.port.onmessage({ data: { type: "start" } });
  worklet.process([[new Float32Array(128).fill(0.4)]]);
  worklet.port.onmessage({ data: { type: "finish" } });
  expect(postMessage).toHaveBeenCalledTimes(4);
  expect(postMessage.mock.calls[0][0]).toEqual({ type: "started" });
  expect(postMessage.mock.calls[1][0]).toEqual(new Float32Array(1024).fill(0.2));
  const tail = postMessage.mock.calls[2][0] as Float32Array;
  expect(tail.length).toBe(256);
  expect(tail.slice(0, 128)).toEqual(new Float32Array(128));
  expect(tail.slice(128)).toEqual(new Float32Array(128).fill(0.4));
  expect(postMessage.mock.calls[3][0]).toEqual({ type: "finished", sampleCount: 1280 });
  worklet.process([[new Float32Array(1024).fill(0.9)]]);
  expect(postMessage).toHaveBeenCalledTimes(4);
});
