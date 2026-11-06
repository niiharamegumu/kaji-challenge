/** Encode fixture audio for the legacy JSON endpoint and Workers AI assertions. */
export const wavBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
