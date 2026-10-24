// The shared response slot for synchronous bridge calls (docs/ARCHITECTURE.md §3).
//
//   Int32 [0]  state: 0 = waiting, 1 = response ready
//   Int32 [1]  response length in bytes
//   bytes 8…   UTF-8 JSON response, at most RESPONSE_CAPACITY bytes
//
// The nova worker resets state to 0, posts the request on its MessagePort and
// blocks in Atomics.wait. The sim worker writes the response and notifies.

export const RESPONSE_CAPACITY = 1024 * 1024; // 1 MiB, NOVALANG_BRIDGE.md §6
const HEADER_BYTES = 8;

export function createResponseBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(HEADER_BYTES + RESPONSE_CAPACITY);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Sim side. Returns false (and writes nothing) if `json` does not fit. */
export function writeResponse(buffer: SharedArrayBuffer, json: string): boolean {
  const bytes = encoder.encode(json);
  if (bytes.length > RESPONSE_CAPACITY) return false;
  new Uint8Array(buffer, HEADER_BYTES, bytes.length).set(bytes);
  const header = new Int32Array(buffer, 0, 2);
  Atomics.store(header, 1, bytes.length);
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
  return true;
}

/** Nova side, before posting a request. */
export function resetResponse(buffer: SharedArrayBuffer): void {
  Atomics.store(new Int32Array(buffer, 0, 2), 0, 0);
}

/**
 * Nova side: block until the response is ready (or `timeoutMs` passes) and
 * return it. TextDecoder refuses shared memory, so the bytes are copied out.
 */
export function awaitResponse(buffer: SharedArrayBuffer, timeoutMs: number): string | null {
  const header = new Int32Array(buffer, 0, 2);
  if (Atomics.wait(header, 0, 0, timeoutMs) === 'timed-out') return null;
  const length = Atomics.load(header, 1);
  return decoder.decode(new Uint8Array(buffer, HEADER_BYTES, length).slice());
}
