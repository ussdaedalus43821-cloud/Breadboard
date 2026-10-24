// Shareable URLs: the save JSON, deflate-compressed and base64url-encoded in
// the URL fragment, e.g. https://…/#circuit=1.eJy… The fragment never reaches
// the server. "1." is the encoding version, independent of the save version.

const PREFIX = 'circuit=1.';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** `#circuit=1.<data>` for a save object. */
export async function encodeShareHash(save: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(save));
  return `#${PREFIX}${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

/**
 * The save object in a URL fragment, null if the fragment is not a shared
 * circuit. Throws with a readable message if it is one but is damaged.
 */
export async function decodeShareHash(hash: string): Promise<unknown> {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h.startsWith(PREFIX)) return null;
  try {
    const bytes = await pipe(
      fromBase64Url(h.slice(PREFIX.length)),
      new DecompressionStream('deflate-raw'),
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('this shared link is damaged or incomplete');
  }
}
