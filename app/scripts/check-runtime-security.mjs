// CVE-2026-111497: verify the decoder itself, including Node.js security backports.
// Regression vector: https://github.com/nodejs/node/blob/v24.22.1/test/parallel/test-zlib-invalid-input.js
import assert from "node:assert/strict";
import { finished } from "node:stream/promises";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants,
  createBrotliDecompress,
} from "node:zlib";

const runtime = process.versions.bun ? `Bun ${process.versions.bun}` : `Node.js ${process.version}`;
const guidance = `${runtime}: CVE-2026-111497 requires patched Brotli. Run mise install and use mise exec -- (Node.js 24.22.1 / Bun 1.4.4 or later supported security releases).`;
// Fail before decoding on an unpatched runtime. The version string alone is insufficient:
// Node.js 24.22.1 reports Brotli 1.2.0 but includes the security backport.
assert.equal(constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH, -17, guidance);

const plain = Buffer.from("kaji-runtime-security-check");
assert.deepEqual(brotliDecompressSync(brotliCompressSync(plain)), plain);

const invalidBlockSwitch = Buffer.from("200010414141fcffff07002228f00b60f7f41f000000", "hex");
const expectedError = { code: "ERR__ERROR_FORMAT_BLOCK_SWITCH", errno: -17 };
assert.throws(() => brotliDecompressSync(invalidBlockSwitch), expectedError, guidance);

// Exercise the streaming path one byte at a time, as in the upstream regression.
const decoder = createBrotliDecompress();
decoder.resume();
const completion = finished(decoder);
for (let index = 0; index < invalidBlockSwitch.length; index++) {
  decoder.write(invalidBlockSwitch.subarray(index, index + 1));
}
decoder.end();
await assert.rejects(completion, expectedError, guidance);
console.info(`${runtime}: CVE-2026-111497 decoder checks passed (sync and streaming).`);
