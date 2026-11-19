import type { ServerResponse } from "node:http";

/** Constant headers set on every response. Never includes Access-Control-*. */
const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  ["Content-Security-Policy", "default-src 'self'"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "no-referrer"],
  ["X-Frame-Options", "DENY"],
];

const REMOVED_HEADERS: readonly string[] = ["X-Powered-By", "Server"];

export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of SECURITY_HEADERS) {
    res.setHeader(name, value);
  }
  for (const name of REMOVED_HEADERS) {
    res.removeHeader(name);
  }
}
