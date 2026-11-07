/**
 * Output capture helpers (pure). appendCapped and encodeStdin run in the
 * Worker; decodeUtf8 runs in the runner after base64 payloads are decoded.
 */

export interface Capture {
  readonly bytes: Buffer;
  readonly truncated: boolean;
}

/**
 * Appends `chunk` to `current`, keeping at most `limit` bytes in total.
 * `truncated` becomes true as soon as any byte had to be dropped, and stays
 * true afterwards. Once the capture is full, further bytes are discarded.
 */
export function appendCapped(current: Capture, chunk: Buffer, limit: number): Capture {
  const cap = Math.max(0, Math.floor(limit));
  const room = Math.max(0, cap - current.bytes.length);
  if (chunk.length <= room) {
    if (chunk.length === 0) return current;
    return {
      bytes: Buffer.concat([current.bytes, chunk]),
      truncated: current.truncated,
    };
  }
  return {
    bytes: Buffer.concat([current.bytes, chunk.subarray(0, room)]),
    truncated: true,
  };
}

/**
 * Decodes bytes as UTF-8 without altering content: the BOM is kept
 * (`ignoreBOM: true`) and invalid sequences become U+FFFD.
 */
export function decodeUtf8(bytes: Buffer): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

/**
 * Encodes input lines for stdin: each line followed by "\n".
 * An empty list yields an empty buffer.
 */
export function encodeStdin(lines: readonly string[]): Buffer {
  if (lines.length === 0) return Buffer.alloc(0);
  return Buffer.from(lines.map((l) => `${l}\n`).join(""), "utf8");
}
