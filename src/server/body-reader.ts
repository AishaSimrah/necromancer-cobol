import type { IncomingMessage, ServerResponse } from "node:http";
import { errorBody, FIXED_MESSAGES, statusOf } from "./errors.js";

export const BODY_LIMIT_BYTES = 1024;

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export type BodyReadResult =
  | { readonly ok: true; readonly body: Buffer }
  | { readonly ok: false; readonly reason: "too_large" | "aborted" };

export type JsonObjectResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false };

/** True when the Content-Type header is `application/json`, optionally with `charset=utf-8`. */
export function checkJsonContentType(header: string | string[] | undefined): boolean {
  if (typeof header !== "string") return false;
  return JSON_CONTENT_TYPE.test(header.trim());
}

/** True when a declared Content-Length is a number above the limit. */
export function declaredTooLarge(req: IncomingMessage, limit: number = BODY_LIMIT_BYTES): boolean {
  const header = req.headers["content-length"];
  if (typeof header !== "string" || !/^[0-9]+$/.test(header.trim())) return false;
  return Number(header.trim()) > limit;
}

/**
 * Reads at most `limit` bytes. A Content-Length above the limit returns
 * `too_large` without reading. Otherwise bytes are counted per chunk and
 * reading stops as soon as the total passes the limit, which also covers
 * chunked bodies and a lying Content-Length.
 */
export function readBodyLimited(req: IncomingMessage, limit: number = BODY_LIMIT_BYTES): Promise<BodyReadResult> {
  if (declaredTooLarge(req, limit)) return Promise.resolve({ ok: false, reason: "too_large" });
  return new Promise<BodyReadResult>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const finish = (result: BodyReadResult): void => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("close", onClose);
      resolve(result);
    };
    const onData = (chunk: Buffer | string): void => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      total += buf.length;
      if (total > limit) {
        req.pause();
        finish({ ok: false, reason: "too_large" });
        return;
      }
      chunks.push(buf);
    };
    const onEnd = (): void => finish({ ok: true, body: Buffer.concat(chunks, total) });
    const onError = (): void => finish({ ok: false, reason: "aborted" });
    const onClose = (): void => {
      if (!req.complete) finish({ ok: false, reason: "aborted" });
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
  });
}

/** Answers 413 with `Connection: close` and destroys the request socket once the response is finished. */
export function sendPayloadTooLarge(req: IncomingMessage, res: ServerResponse): void {
  const text = JSON.stringify(errorBody("payload_too_large", FIXED_MESSAGES.payload_too_large));
  res.once("finish", () => req.destroy());
  res.writeHead(statusOf("payload_too_large"), {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(text)),
    Connection: "close",
  });
  res.end(text);
}

/** Strict UTF-8 decode, JSON.parse, and a plain-object check (not null, not an array). */
export function parseJsonObject(buffer: Buffer): JsonObjectResult {
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false };
  return { ok: true, value: parsed as Record<string, unknown> };
}
