import type { WorkerMessage } from "./protocol.js";

/** Largest accepted frame payload: 8 MiB. */
export const MAX_FRAME_BYTES: number = 8 * 1024 * 1024;

const PREFIX_BYTES = 4;

export type ProtocolErrorCode = "frame_too_large" | "invalid_json";

/** Raised for malformed frames. The client treats it as Worker loss. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

/** 4-byte big-endian length followed by that many bytes of UTF-8 JSON. */
export function encodeFrame(message: WorkerMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > MAX_FRAME_BYTES) {
    throw new ProtocolError(
      "frame_too_large",
      `frame payload of ${payload.length} bytes exceeds ${MAX_FRAME_BYTES}`,
    );
  }
  const out = Buffer.allocUnsafe(PREFIX_BYTES + payload.length);
  out.writeUInt32BE(payload.length, 0);
  payload.copy(out, PREFIX_BYTES);
  return out;
}

/** Incremental decoder: returns zero or more complete messages per chunk. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): readonly WorkerMessage[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: WorkerMessage[] = [];
    let offset = 0;

    while (this.buffer.length - offset >= PREFIX_BYTES) {
      const length = this.buffer.readUInt32BE(offset);
      if (length > MAX_FRAME_BYTES) {
        throw new ProtocolError(
          "frame_too_large",
          `length prefix ${length} exceeds ${MAX_FRAME_BYTES}`,
        );
      }
      const end = offset + PREFIX_BYTES + length;
      if (this.buffer.length < end) break;
      const text = this.buffer.subarray(offset + PREFIX_BYTES, end).toString("utf8");
      offset = end;
      messages.push(parseMessage(text));
    }

    this.buffer = Buffer.from(this.buffer.subarray(offset));
    return messages;
  }
}

function parseMessage(text: string): WorkerMessage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ProtocolError("invalid_json", "frame payload is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError("invalid_json", "frame payload is not a JSON object");
  }
  return value as WorkerMessage;
}
