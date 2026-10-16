// Application APIs carry small JSON/form payloads, never uploaded files.
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** Bound bytes before framework/provider parsers allocate JSON or form objects. */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  let body = new Uint8Array(0);
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      // Content-Length can be absent or incorrect; count the actual stream.
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      // Keep allocation bounded even when the sender produces many tiny chunks.
      // Retaining each Uint8Array separately would not bound object overhead.
      if (length > body.byteLength) {
        const grown = new Uint8Array(
          Math.min(maxBytes, Math.max(length, body.byteLength * 2, 4096)),
        );
        grown.set(body);
        body = grown;
      }
      body.set(value, length - value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }
  return body.subarray(0, length);
}

export async function boundRequestBody(request: Request): Promise<Request | Response> {
  if (!request.body) return request;
  try {
    const body = await readBoundedBody(request, MAX_REQUEST_BODY_BYTES);
    if (body === null) return new Response("Request too large", { status: 413 });
    return new Request(request, { method: request.method, body });
  } catch {
    // Stream errors can include client-controlled data; do not log or expose them.
    return new Response("Invalid request body", { status: 400 });
  }
}
