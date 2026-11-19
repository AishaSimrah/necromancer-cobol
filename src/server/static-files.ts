import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { errorBody, NOT_FOUND_STATIC_MESSAGE, FIXED_MESSAGES } from "./errors.js";

const INDEX_FILE = "index.html";
const CACHE_INDEX = "no-cache";
const CACHE_OTHER = "public, max-age=3600";
const DEFAULT_TYPE = "application/octet-stream";

/** Fixed extension table. Text types carry charset=utf-8, including svg. */
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
});

export interface StaticTarget {
  readonly filePath: string;
  readonly size: number;
  readonly contentType: string;
  readonly cacheControl: string;
}

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return Object.hasOwn(CONTENT_TYPES, ext) ? (CONTENT_TYPES[ext] ?? DEFAULT_TYPE) : DEFAULT_TYPE;
}

function decodeOnce(rawPath: string): string | null {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return null;
  }
}

/** Returns the path segments below the root, or null if the path is not allowed. */
function safeSegments(rawPath: string): readonly string[] | null {
  if (rawPath === "/") return [INDEX_FILE];
  if (!rawPath.startsWith("/")) return null;
  const decoded = decodeOnce(rawPath);
  if (decoded === null) return null;
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.endsWith("/")) return null;
  const segments = decoded.slice(1).split("/");
  const bad = segments.some((s) => s === "" || s.startsWith("."));
  return bad ? null : segments;
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

/**
 * Maps a raw URL path to a regular file inside `realRoot` (already a real path).
 * Returns null for anything that must answer 404.
 */
export async function resolveStaticPath(rawPath: string, realRoot: string): Promise<StaticTarget | null> {
  const segments = safeSegments(rawPath);
  if (segments === null) return null;
  const real = await realpathOrNull(path.join(realRoot, ...segments));
  if (real === null || !real.startsWith(realRoot + path.sep)) return null;
  const info = await stat(real).catch(() => null);
  if (info === null || !info.isFile()) return null;
  const isIndex = path.basename(real) === INDEX_FILE && path.dirname(real) === realRoot;
  return {
    filePath: real,
    size: info.size,
    contentType: contentTypeFor(real),
    cacheControl: isIndex ? CACHE_INDEX : CACHE_OTHER,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    ...extra,
  });
  res.end(text);
}

function rawPathOf(url: string | undefined): string {
  const u = url ?? "/";
  const q = u.indexOf("?");
  return q === -1 ? u : u.slice(0, q);
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, realRoot: string): Promise<void> {
  const method = req.method ?? "";
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, errorBody("method_not_allowed", FIXED_MESSAGES.method_not_allowed), { Allow: "GET, HEAD" });
    return;
  }
  const target = await resolveStaticPath(rawPathOf(req.url), realRoot);
  if (target === null) {
    sendJson(res, 404, errorBody("not_found", NOT_FOUND_STATIC_MESSAGE));
    return;
  }
  res.writeHead(200, {
    "Content-Type": target.contentType,
    "Content-Length": target.size,
    "Cache-Control": target.cacheControl,
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  await pipeline(createReadStream(target.filePath), res).catch(() => {
    res.destroy();
  });
}
